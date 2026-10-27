// How long to wait out a 429 from TheIntroDB, and which of the two it is.
//
// The API shapes both of its 429s the same way -- same JSON keys, same
// Retry-After -- and uses `code` as the only discriminator. The rules are in
// TheIntroDB/.github docs/rate-limit-contract.md; this module is the IINA
// plugin's implementation of them.
//
// The wait is read from the body rather than the Retry-After header because
// IINA's `http.get` hands back `{statusCode, text, data}` with no headers. The
// API writes the same instant to Retry-After and to retry_after_seconds, so the
// body carries the value the contract asks for.

/** A daily budget resets at UTC midnight, so nothing is worth waiting longer. */
export const MAX_WAIT_SECONDS = 24 * 60 * 60;

/** A daily reset is hours away, so a wait past this cannot be a burst. Matches
 * the 300s line jellyfin-plugin, emby-plugin and kodi-addon use, so an
 * unrecognised 429 is read the same way by all of them. */
export const USAGE_WAIT_FLOOR_SECONDS = 300;

/** Only for a 429 that carries no usable number at all. */
const FALLBACK_WAIT_SECONDS = 60;

const USAGE_CODES = new Set([
  "usage_limit_exceeded",
  "specific_media_usage_limit_exceeded",
]);

/** The API's human form: "10 seconds", "14.0 hours". */
function parseHumanSeconds(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([\d.]+)\s*(second|minute|hour|day)s?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2].toLowerCase();
  const perUnit =
    unit === "second" ? 1 : unit === "minute" ? 60 : unit === "hour" ? 3600 : 86400;
  return amount * perUnit;
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads a 429 into `{ kind, seconds, code }`.
 *
 * `kind` is "rate" (a burst: retry after the wait) or "usage" (the day's budget
 * is spent: stop until the window rolls over). `seconds` is always usable,
 * clamped to 1..86400 -- never down to the burst window, which is the clamp that
 * turns "come back tomorrow" into "come back in five minutes".
 *
 * Accepts the parsed body or the raw text, and survives neither being JSON.
 */
export function rateLimitFrom(body) {
  let payload = body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = null;
    }
  }
  const data = payload && typeof payload === "object" ? payload : {};
  const code = typeof data.code === "string" ? data.code : "";

  const wait =
    numeric(data.retry_after_seconds) ??
    parseHumanSeconds(data.retry_after) ??
    FALLBACK_WAIT_SECONDS;
  // `Math.max(..., 1)` is what the API does to its own Retry-After, so a server
  // that sends an explicit 0 still gets a second's pause rather than a retry
  // storm; a value that is missing entirely takes the fallback above.
  const seconds = Math.min(Math.max(Math.ceil(wait), 1), MAX_WAIT_SECONDS);

  const kind = USAGE_CODES.has(code)
    ? "usage"
    : code === "rate_limit_exceeded"
      ? "rate"
      : seconds > USAGE_WAIT_FLOOR_SECONDS
        ? "usage"
        : "rate";

  return { kind, seconds, code };
}

/** "10s", "~2m", "~14.0h" -- for a message a person reads. */
export function formatWait(seconds) {
  if (seconds >= 3600) return `~${(seconds / 3600).toFixed(1)}h`;
  if (seconds >= 60) return `~${Math.floor(seconds / 60)}m`;
  return `${seconds}s`;
}

/**
 * A 429, carrying the wait so the caller can retry or explain instead of
 * seeing it as just another HTTP error.
 */
export class RateLimitError extends Error {
  constructor(limit) {
    super(`TheIntroDB: rate limited (${limit.kind}, ${limit.seconds}s)`);
    this.name = "RateLimitError";
    this.rateLimit = limit;
  }
}
