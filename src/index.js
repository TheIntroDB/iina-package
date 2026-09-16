import {
  identify, tmdbSearch, fetchSegments,
  currentSegment, segmentsToMpvChapters,
} from "./tidb.js";

const { event, core, mpv, menu, overlay, preferences, console } = iina;

const BUILT_IN_TMDB_KEY = process.env.TMDB_READ_API_KEY || "";
const MIN_REMAINING_TO_SHOW = 5; // don't show the button if the segment ends this soon anyway

const OVERLAY_CSS = `
  body { margin: 0; background: transparent; }
  .tidb-skip-btn {
    position: fixed;
    right: 24px;
    bottom: 72px;
    padding: 10px 20px;
    background: rgba(20,20,20,0.85);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 4px;
    font: 14px -apple-system, sans-serif;
    cursor: pointer;
    animation: tidb-fade-in 200ms ease;
  }
  .tidb-skip-btn:hover { background: rgba(40,40,40,0.95); }
  @keyframes tidb-fade-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

let segments = [];
let autoSkip = false;
let autoSkipKinds = new Set();
let seekGraceUntil = 0;
let activeSegment = null;
let activeSegmentId = null;

function fmtTime(s) {
  if (s == null) return "end";
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function basename(url) {
  try { return decodeURIComponent(url).split("/").pop(); } catch { return url; }
}

function label(kind) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function segmentId(seg) {
  return seg ? `${seg.kind}:${seg.start}` : null;
}

// an open-ended segment (no explicit end) effectively ends at the file's
// duration — used only for deciding whether the button is "about to end
// anyway", not for skip targeting (see doSkip)
function effectiveEnd(seg) {
  if (seg.end != null) return seg.end;
  const dur = core.status.duration;
  return dur > 0 ? dur : Infinity;
}

function showSkipButton(seg) {
  overlay.setContent(
    `<button class="tidb-skip-btn" data-clickable onclick="iina.postMessage('skip', {})">Skip ${label(seg.kind)}</button>`
  );
  overlay.show();
}

function hideSkipButton() {
  overlay.hide();
}

function doSkip(seg, isAuto) {
  const pos = core.status.position;
  const dur = core.status.duration;
  // open-ended segments (typically credits) run to the end of the file
  let target = seg.end != null ? seg.end : dur;
  if (target == null || target <= pos) return false;
  if (dur > 0 && target >= dur - 0.2) target = Math.max(0, dur - 0.1);

  core.seekTo(target);
  // retire this segment for the rest of the session so it can't re-match on
  // the very next tick (boundary is inclusive) or linger forever if open-ended
  segments = segments.filter((s) => s !== seg);
  seekGraceUntil = Date.now() + 1500;
  core.osd(`${isAuto ? "Auto-skipped" : "Skipped"} ${label(seg.kind)} → ${fmtTime(seg.end)}`);
  return true;
}

function skipKind(kind) {
  const pos = core.status.position;
  const seg = segments.find((s) => s.kind === kind && pos >= s.start && (s.end == null || pos <= s.end));
  if (seg && doSkip(seg, false)) return;
  const next = segments.filter((s) => s.kind === kind && s.start > pos).sort((a, b) => a.start - b.start)[0];
  if (next) doSkip(next, false);
  else core.osd(`TheIntroDB: no ${kind} segment`);
}

function loadAutoSkipPrefs() {
  autoSkip = !!preferences.get("autoSkip");
  const types = (preferences.get("autoSkipTypes") || "intro,recap").split(",").map((s) => s.trim());
  autoSkipKinds = new Set(types);
}

function tick() {
  const pos = core.status.position;
  if (pos == null) return;

  const seg = currentSegment(segments, pos);
  const showable = !!seg && (effectiveEnd(seg) - pos > MIN_REMAINING_TO_SHOW);
  const id = showable ? segmentId(seg) : null;

  if (id !== activeSegmentId) {
    activeSegmentId = id;
    activeSegment = showable ? seg : null;
    if (showable) showSkipButton(seg);
    else hideSkipButton();
  }

  if (!autoSkip || core.status.paused) return;
  if (Date.now() < seekGraceUntil) return;
  // deliberately still excluded from auto-skip: an open-ended segment auto-
  // skipping straight to EOF with no user confirmation is too risky to do
  // silently in the background, even though manual skip now supports it
  if (!seg || !autoSkipKinds.has(seg.kind) || seg.end == null) return;
  doSkip(seg, true);
  activeSegment = null;
  activeSegmentId = null;
  hideSkipButton();
}

async function loadForCurrentFile() {
  segments = [];
  activeSegment = null;
  activeSegmentId = null;
  hideSkipButton();

  const filename = basename(core.status.url);
  const info = identify(filename);
  console.log(`[TheIntroDB] identify() -> ${JSON.stringify(info)}`);

  let { tmdbId, imdbId, season, episode } = info;

  if (!tmdbId && !imdbId) {
    if (!info.title) {
      console.log("[TheIntroDB] scene-parser returned no usable title, aborting");
      return;
    }
    const tmdbKey = preferences.get("tmdbApiKey") || BUILT_IN_TMDB_KEY;
    const id = await tmdbSearch(info.title, info.year, info.isTv, tmdbKey);
    if (!id) {
      console.log(`[TheIntroDB] no TMDB match for "${info.title}"`);
      return;
    }
    tmdbId = String(id);
  }

  const apiKey = preferences.get("tidbApiKey") || "";
  const durationMs = Math.round((core.status.duration || 0) * 1000);

  let found;
  try {
    found = await fetchSegments({ tmdbId, imdbId, season, episode, durationMs, apiKey });
  } catch (err) {
    console.log(`[TheIntroDB] fetchSegments threw: ${err}`);
    return;
  }

  if (!found) {
    console.log("[TheIntroDB] TIDB returned no data for this media");
    return;
  }
  segments = found;
  console.log(`[TheIntroDB] loaded ${segments.length} segment(s)`);
  mpv.set("chapter-list", segmentsToMpvChapters(segments));
}

event.on("iina.window-loaded", () => {
  loadAutoSkipPrefs();
  overlay.simpleMode();
  overlay.setStyle(OVERLAY_CSS);
  overlay.setClickable(true);

  overlay.onMessage("skip", () => {
    if (!activeSegment) return;
    const seg = activeSegment;
    activeSegment = null;
    activeSegmentId = null;
    hideSkipButton();
    doSkip(seg, false);
  });

  setInterval(tick, 400);

  event.on("iina.file-loaded", () => {
    loadAutoSkipPrefs();
    loadForCurrentFile().catch((err) => {
      console.log(`[TheIntroDB] loadForCurrentFile failed: ${err}`);
    });
  });

  menu.addItem(menu.item("Skip Intro", () => skipKind("intro")));
  menu.addItem(menu.item("Skip Recap", () => skipKind("recap")));
  menu.addItem(menu.item("Skip Credits", () => skipKind("credits")));
  menu.addItem(menu.item("Toggle Auto-Skip", () => {
    autoSkip = !autoSkip;
    preferences.set("autoSkip", autoSkip);
    preferences.sync();
    core.osd(`TheIntroDB: auto-skip ${autoSkip ? "ON" : "OFF"}`);
  }));
});