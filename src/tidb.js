import { parseTitle } from "@fifth/scene-parser";

import { RateLimitError, rateLimitFrom } from "./rateLimit";

const { http, console } = iina;

export const TIDB_API_URL = "https://api.theintrodb.org/v4/media";
const KINDS = ["intro", "recap", "credits", "preview"];

// Epoch seconds the caller's daily budget is spent until, set when a 429 says
// so. The budget is per account/IP rather than per file, so this outlives a file
// change. The per-title limit is a different budget and is held separately: a
// spent title must not stop a lookup for another title.
let limitedUntil = 0;
const limitedTargets = new Map();

/** The media a request is about, so a per-title hold can be scoped to it. */
function targetKey({ tmdbId, imdbId, season, episode }) {
  return [tmdbId || imdbId || "?", season || "", episode || ""].join(":");
}

/**
 * The hold in force for this target, or null. An account-wide hold outranks a
 * per-title one, and both come back in the shape the caller reports.
 */
export function rateLimitHold(target) {
  const account = Math.max(0, Math.ceil(limitedUntil - Date.now() / 1000));
  if (account > 0) {
    return { kind: "usage", scope: "account", code: "held", seconds: account };
  }
  const title = Math.max(
    0,
    Math.ceil((limitedTargets.get(target) || 0) - Date.now() / 1000)
  );
  if (title > 0) {
    return { kind: "usage", scope: "title", code: "held", seconds: title };
  }
  return null;
}

// ---- filename -> title/year/season/episode ---------------------------------

export function identify(filename) {
  console.log(`[TheIntroDB] parsing filename: ${filename}`);
  let parsed;
  try {
    parsed = parseTitle(filename);
  } catch (err) {
    console.log(`[TheIntroDB] scene-parser threw: ${err}`);
    return { title: null, year: null, isTv: false, season: null, episode: null, tmdbId: null, imdbId: null };
  }
  console.log(`[TheIntroDB] scene-parser result: ${JSON.stringify(parsed)}`);

  const isTv = parsed.type === "show" || parsed.type === "seasonpack";

  // scene-parser doesn't look for embedded tmdb/imdb ids (not a scene convention)
  const tmdbMatch = filename.match(/[Tt][Mm][Dd][Bb][\s_.-]*(\d+)/);
  const imdbMatch = filename.match(/tt\d{7,8}/);

  return {
    title: parsed.title || null,
    year: parsed.year != null ? String(parsed.year) : null,
    isTv,
    season: isTv && parsed.season != null ? String(parsed.season) : null,
    episode: isTv && parsed.episode != null ? String(parsed.episode) : null,
    tmdbId: tmdbMatch ? tmdbMatch[1] : null,
    imdbId: imdbMatch ? imdbMatch[0] : null,
  };
}

// ---- TMDB fallback search ----------------------------------------------------

export async function tmdbSearch(title, year, isTv, tmdbKey) {
  if (!tmdbKey) {
    console.log("[TheIntroDB] no TMDB key configured, skipping search");
    return null;
  }
  const endpoint = isTv ? "/search/tv" : "/search/movie";
  // deliberately NOT filtering by year server-side — TMDB's year filters are
  // hard filters, and scene release years are wrong often enough that this
  // would zero out otherwise-good matches. `year` is only used below, to pick
  // the best candidate among the real results.
  const url = `https://api.themoviedb.org/3${endpoint}?query=${encodeURIComponent(title)}&language=en-US`;

  console.log(`[TheIntroDB] TMDB GET ${url}`);
  const res = await http.get(url, { headers: { Authorization: `Bearer ${tmdbKey}` } });
  console.log(`[TheIntroDB] TMDB status=${res.statusCode} body=${(res.text || "").slice(0, 300)}`);

  if (res.statusCode !== 200) return null;
  const data = res.data ?? JSON.parse(res.text);
  if (!data.results?.length) return null;

  let best = data.results[0]; // TMDB already ranks by relevance/popularity
  if (year) {
    const match = data.results.find(
      (r) => (r.release_date || r.first_air_date || "").slice(0, 4) === year
    );
    if (match) best = match; // only override if we find an exact year match
  }
  console.log(`[TheIntroDB] TMDB matched id=${best.id} name="${best.title || best.name}"`);
  return best.id;
}

// ---- TIDB segment fetch -----------------------------------------------------

export async function fetchSegments({ tmdbId, imdbId, season, episode, durationMs, apiKey }) {
  const target = targetKey({ tmdbId, imdbId, season, episode });
  const held = rateLimitHold(target);
  if (held) {
    // Inside the wait the API named. Asking again would spend another request
    // against a budget that is already gone and earn another 429.
    console.log(
      `[TheIntroDB] ${held.scope} limit still in force for ${target} (${held.seconds}s left), not asking`
    );
    throw new RateLimitError(held);
  }
  // built with plain string concatenation, not URLSearchParams — that's a
  // browser/Node global not guaranteed to exist in IINA's JS runtime, and its
  // absence here was previously failing before this function could log anything.
  const parts = [];
  if (tmdbId) parts.push(`tmdb_id=${encodeURIComponent(tmdbId)}`);
  else if (imdbId) parts.push(`imdb_id=${encodeURIComponent(imdbId)}`);
  if (season && episode) {
    parts.push(`season=${encodeURIComponent(season)}`);
    parts.push(`episode=${encodeURIComponent(episode)}`);
  }
  if (durationMs) parts.push(`duration_ms=${durationMs}`);

  const url = `${TIDB_API_URL}?${parts.join("&")}`;
  console.log(`[TheIntroDB] TIDB GET ${url}`);
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  // IINA rejects http.get for any non-2xx response and hands the response to the
  // rejection handler -- `(response.ok ? resolve : reject)` in IINA's
  // JavascriptAPIHttp.swift -- so a 404 or a 429 arrives here and not on the
  // line below. Everything else still throws as it did.
  let res;
  try {
    res = await http.get(url, { headers });
  } catch (rejected) {
    if (rejected && typeof rejected === "object" && "statusCode" in rejected) {
      res = rejected;
    } else {
      throw rejected;
    }
  }
  console.log(`[TheIntroDB] TIDB status=${res.statusCode}`);

  if (res.statusCode === 404 || res.statusCode === 400) return null; // no data for this media
  if (res.statusCode === 429) {
    // `http.get` gives back the body, not the headers, so the wait comes from
    // the body -- same instant as Retry-After. See TheIntroDB/.github
    // docs/rate-limit-contract.md.
    const limit = rateLimitFrom(res.data ?? res.text);
    if (limit.kind === "usage") {
      const until = Date.now() / 1000 + limit.seconds;
      // A per-title limit is spent for this target only, so hold it per target
      // rather than stopping every title until it resets.
      if (limit.scope === "title") limitedTargets.set(target, until);
      else limitedUntil = until;
    }
    console.log(`[TheIntroDB] TIDB 429: ${limit.kind} (${limit.scope}), ${limit.seconds}s`);
    throw new RateLimitError(limit);
  }
  if (res.statusCode !== 200) throw new Error(`TheIntroDB: HTTP ${res.statusCode}`);

  const data = res.data ?? JSON.parse(res.text);
  const segments = buildSegments(data);
  console.log(`[TheIntroDB] parsed segments: ${JSON.stringify(segments)}`);
  return segments;
}

function buildSegments(data, durationSec = 0) {
  const segments = [];
  for (const kind of KINDS) {
    const list = data[kind];
    if (!Array.isArray(list)) continue;
    for (const seg of list) {
      if (!seg) continue;
      const startMs = seg.start_ms, endMs = seg.end_ms;
      if (startMs === 0 && endMs === 0) continue; // "no segment"
      if (endMs == null || endMs === 0) {
        // Only credits/preview may carry a null end, and those are exactly the
        // types that always carry a start (the API partitions the two:
        // SegmentAllowsNullEnd vs SegmentRequiresStart), so a null start never
        // reaches here — it is handled above. A start of exactly 0 here means
        // "credits from 0:00 to the end of the file", which is not a skip target.
        if (startMs > 0) segments.push({ kind, start: startMs / 1000, end: null });
      } else {
        let start = (startMs || 0) / 1000;
        let end = endMs / 1000;
        if (durationSec > 0 && end > durationSec) end = durationSec;
        segments.push({ kind, start, end });
      }
    }
  }
  segments.sort((a, b) =>
    a.start !== b.start ? a.start - b.start : (a.end ?? Infinity) - (b.end ?? Infinity)
  );
  return segments;
}

export function currentSegment(segments, pos) {
  return segments.find((s) => pos >= s.start && (s.end == null || pos <= s.end)) || null;
}

// mpv's native chapter-list entries use {title, time} — not IINA's Chapter
// type, which uses {title, start}. This writes directly to the mpv property.
export function segmentsToMpvChapters(segments) {
  const label = (k) => k.charAt(0).toUpperCase() + k.slice(1);
  const chapters = [];
  let lastEnd = 0;
  for (const seg of segments) {
    if (seg.start > lastEnd + 0.5 && !chapters.some((c) => c.time === lastEnd)) {
      chapters.push({ title: "Episode", time: lastEnd });
    }
    chapters.push({ title: label(seg.kind), time: seg.start });
    if (seg.end != null) lastEnd = seg.end;
  }
  if (segments.length && lastEnd > 0) chapters.push({ title: "Episode", time: lastEnd });
  return chapters.sort((a, b) => a.time - b.time);
}