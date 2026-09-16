import { parseTitle } from "@fifth/scene-parser";

const { http, console } = iina;

export const TIDB_API_URL = "https://api.theintrodb.org/v3/media";
const KINDS = ["intro", "recap", "credits", "preview"];

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
  const res = await http.get(url, { headers });
  console.log(`[TheIntroDB] TIDB status=${res.statusCode}`);

  if (res.statusCode === 404 || res.statusCode === 400) return null; // no data for this media
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