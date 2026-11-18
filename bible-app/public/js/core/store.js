// Application state: reading preferences and reading progress.
// Small observable store; persisted through the storage adapter.
import * as storage from "./storage.js";

export const DEFAULT_PREFS = {
  pinyin: "hard",            // "off" | "hard" (harder words only) | "all"
  zhVersion: "cuv",
  enVersion: "web",
  script: "simplified",
  zhSize: (globalThis.innerWidth || 1024) < 720 ? 20 : 22,
  pySize: 11,
  enSize: (globalThis.innerWidth || 1024) < 720 ? 16 : 17,
  leading: 2.05,
  measure: 34,               // em, Chinese column width
  redLetter: true,           // words of Jesus in rubric red (WEB)
  showNotes: true,           // translators' footnotes markers
  showHeadings: true,        // CUV parallel-passage references
};

const subs = new Map();
const state = {
  prefs: { ...DEFAULT_PREFS, ...storage.getDoc("prefs", {}) },
  progress: storage.getDoc("progress", { last: null, books: {} }),
};

export function get(key) { return state[key]; }

export function subscribe(key, fn) {
  if (!subs.has(key)) subs.set(key, new Set());
  subs.get(key).add(fn);
  return () => subs.get(key).delete(fn);
}
function notify(key) { (subs.get(key) || []).forEach(fn => fn(state[key])); }

// prefs from older versions (reading "mode", collapsed English) are ignored
delete state.prefs.mode; delete state.prefs.collapseEnglishMobile;

export function setPrefs(patch) {
  state.prefs = { ...state.prefs, ...patch };
  storage.setDoc("prefs", state.prefs);
  notify("prefs");
}

// progress: { last: {book, chapter, verse, at}, books: { JHN: { read: [1,2,...], lastChapter } } }
export function setPosition(book, chapter, verse) {
  const p = state.progress;
  const same = p.last && p.last.book === book && p.last.chapter === chapter && p.last.verse === verse;
  if (same) return;
  p.last = { book, chapter, verse, at: Date.now() };
  p.books[book] = p.books[book] || { read: [] };
  p.books[book].lastChapter = chapter;
  storage.setDoc("progress", p);
  notify("progress");
}
export function markChapterRead(book, chapter) {
  const b = (state.progress.books[book] = state.progress.books[book] || { read: [] });
  if (b.read.includes(chapter)) return;
  b.read.push(chapter); b.read.sort((a, z) => a - z);
  storage.setDoc("progress", state.progress);
  notify("progress");
}

// Re-read from storage after the cloud copy has been pulled in.
export function reload() {
  state.prefs = { ...DEFAULT_PREFS, ...storage.getDoc("prefs", {}) };
  state.progress = storage.getDoc("progress", { last: null, books: {} });
  notify("prefs"); notify("progress");
}

// Apply typographic preferences as CSS custom properties.
export function applyTypography(p = state.prefs) {
  const r = document.documentElement.style;
  r.setProperty("--zh-size", p.zhSize + "px");
  r.setProperty("--py-size", p.pySize + "px");
  r.setProperty("--en-size", p.enSize + "px");
  r.setProperty("--leading", p.leading);
  r.setProperty("--measure", p.measure + "em");
}
