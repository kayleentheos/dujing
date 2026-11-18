// Player engine: plays a Track verse by verse. No DOM beyond one <audio>.
// Emits a snapshot on every change: { track, index, playing, rate, mode, time, progress }.
const audio = new Audio();
audio.preload = "auto";
if ("preservesPitch" in audio) audio.preservesPitch = true;

const blobs = new Map();        // file -> object URL (files are fetched so they play under the page's policy)
const subs = new Set();
const state = { track: null, index: 0, playing: false, rate: 1, mode: "chapter", time: 0, loading: false, error: null };
let loadedFile = null, loadToken = 0;

export const RATES = [0.5, 0.75, 1, 1.25, 1.5];
export function subscribe(fn) { subs.add(fn); fn(snapshot()); return () => subs.delete(fn); }
function emit() { const s = snapshot(); subs.forEach(fn => fn(s)); }
export function snapshot() {
  const t = state.track;
  const before = t ? t.segments.slice(0, state.index).reduce((n, s) => n + s.duration, 0) : 0;
  const seg = t && t.segments[state.index];
  const within = seg ? Math.max(0, Math.min(seg.duration, state.time)) : 0;
  return { ...state, segment: seg || null, progress: t && t.total ? (before + within) / t.total : 0, elapsed: before + within };
}

async function urlFor(file) {
  if (!blobs.has(file)) {
    blobs.set(file, fetch(file).then(r => { if (!r.ok) throw new Error(`audio ${r.status}`); return r.blob(); })
      .then(b => URL.createObjectURL(b)).catch(e => { blobs.delete(file); throw e; }));
  }
  return blobs.get(file);
}
function prefetch(i) { const s = state.track && state.track.segments[i]; if (s) urlFor(s.file).catch(() => { }); }

export function load(track) {
  if (state.track && track && state.track.set === track.set && state.track.book === track.book && state.track.chapter === track.chapter) return;
  stop();
  state.track = track; state.index = 0; state.time = 0; state.error = null;
  loadedFile = null;
  if (track) prefetch(0);
  emit();
}

export function unload() { stop(); state.track = null; emit(); }

async function startSegment(i, { autoplay = true } = {}) {
  const t = state.track; if (!t) return;
  if (i < 0 || i >= t.segments.length) { state.playing = false; emit(); return; }
  state.index = i; state.time = 0; state.error = null;
  const seg = t.segments[i];
  const token = ++loadToken;
  state.loading = true; emit();
  try {
    const url = await urlFor(seg.file);
    if (token !== loadToken) return;
    if (loadedFile !== seg.file) { audio.src = url; loadedFile = seg.file; }
    audio.currentTime = seg.start || 0;
    audio.playbackRate = state.rate;
    if (autoplay) { await audio.play(); state.playing = true; }
  } catch (e) {
    if (token !== loadToken) return;
    state.playing = false;
    state.error = e && e.name === "NotAllowedError" ? "Tap play to start audio." : "This audio could not be played.";
  } finally {
    if (token === loadToken) { state.loading = false; emit(); }
  }
  prefetch(i + 1);
}

export function playFrom(verseId) {
  const t = state.track; if (!t) return;
  const i = t.segments.findIndex(s => s.verseId === verseId);
  if (i >= 0) startSegment(i);
}
export async function play() {
  if (!state.track) return;
  const seg = state.track.segments[state.index];
  if (loadedFile === (seg && seg.file) && audio.src && !audio.ended && audio.currentTime > (seg.start || 0) && audio.currentTime < seg.end) {
    // resume exactly where it was paused
    try { audio.playbackRate = state.rate; await audio.play(); state.playing = true; } catch { state.error = "Tap play to start audio."; }
    emit();
  } else startSegment(state.index);
}
export function pause() { audio.pause(); state.playing = false; emit(); }
export function toggle() { state.playing ? pause() : play(); }
export function stop() { loadToken++; audio.pause(); state.playing = false; state.time = 0; }
export function next() { if (state.track) startSegment(Math.min(state.index + 1, state.track.segments.length - 1), { autoplay: true }); }
export function prev() {
  if (!state.track) return;
  // like a music player: early in a verse goes back one verse, later restarts it
  const target = state.time > 1.2 ? state.index : Math.max(0, state.index - 1);
  startSegment(target);
}
export function replay() { startSegment(state.index); }
export function setRate(r) { state.rate = r; audio.playbackRate = r; emit(); }
export function cycleRate() { const i = RATES.indexOf(state.rate); setRate(RATES[(i + 1) % RATES.length]); }
export function setMode(m) { state.mode = m; emit(); }

// Verse boundaries inside one chapter file are checked every animation frame
// while playing (timeupdate alone fires only ~4 times a second).
function tick() {
  const seg = state.track && state.track.segments[state.index];
  if (!seg) return;
  const t = audio.currentTime;
  const next = state.track.segments[state.index + 1];
  if (seg.end && t >= seg.end - 0.015 && next && next.file === seg.file) {
    if (state.mode === "verse") { audio.pause(); audio.currentTime = seg.end - 0.01; state.playing = false; state.time = seg.duration; emit(); return; }
    state.index++;
  }
  const cur = state.track.segments[state.index];
  state.time = t - (cur.start || 0);
  emit();
}
let raf = 0;
function loop() { tick(); if (!audio.paused) raf = requestAnimationFrame(loop); }
audio.addEventListener("play", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); });
audio.addEventListener("timeupdate", () => { if (audio.paused) tick(); });
audio.addEventListener("ended", () => {
  if (!state.track) return;
  if (state.mode === "verse" || state.index >= state.track.segments.length - 1) {
    state.playing = false; state.time = state.track.segments[state.index].duration; emit(); return;
  }
  startSegment(state.index + 1);
});
audio.addEventListener("pause", () => { if (state.playing && !audio.ended) { state.playing = false; emit(); } });

// read-only hook used by the automated tests (no effect on the app)
globalThis.__dujingAudio = { audio, snapshot };
