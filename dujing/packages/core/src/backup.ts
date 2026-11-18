// Backups and imports.
//
// A backup ("dujing-backup", formatVersion 1) is one JSON file holding all of a
// user's data. Two producers exist today and both are accepted:
//   * the original app's "Back up my data" page:  { docs: { prefs: {data}, progress: {data} }, collections: { vocab: [{data}], highlights: [{data}] } }
//   * a server-side snapshot of the same data:   same shape, each entry also carrying docId / version / cloudUpdatedAt
//
// parseBackup() turns either into a validated UserSnapshot (rejecting, never
// silently dropping, anything malformed). planImport() merges a snapshot into
// what an account already holds: words are matched by word+pinyin, verse links
// by verse, review answers by (time, result), highlights by id and position —
// so importing the same file twice changes nothing.
import { HIGHLIGHT_COLORS } from "./types";
import type { Bookmark, Highlight, ReadingProgress, ReadingSettings, ReviewEvent, SrsState, VocabRef, VocabWord } from "./types";

export const BACKUP_FORMAT = "dujing-backup";
export const BACKUP_VERSION = 1;

export interface UserSnapshot {
  settings: ReadingSettings | null;
  progress: ReadingProgress | null;
  words: VocabWord[];
  highlights: Highlight[];
  bookmarks: Bookmark[];
}
export const emptySnapshot = (): UserSnapshot => ({ settings: null, progress: null, words: [], highlights: [], bookmarks: [] });

export interface Rejected { kind: string; id: string | null; reason: string }
export interface ParsedBackup { snapshot: UserSnapshot; rejected: Rejected[]; exportedAt: string | null; source: unknown }

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const VERSE_ID = /^[1-4A-Z]{3}\.\d+\.\d+$/;
const unwrap = (x: unknown) => (isObj(x) && "data" in x ? (x as any).data : x);

function checkWord(w: any): string | null {
  if (!isObj(w)) return "not an object";
  if (!isStr(w.word) || !w.word) return "missing word";
  if (!isStr(w.pinyin)) return "missing pinyin";
  if (w.id !== `${w.word}|${w.pinyin}`) return `id ${w.id} does not match word|pinyin`;
  if (!Array.isArray(w.refs) || !w.refs.length) return "no verse links";
  for (const r of w.refs) {
    if (!isObj(r) || !isStr(r.verseId) || !VERSE_ID.test(r.verseId)) return "a verse link has no valid verseId";
    if (!isStr(r.zh) || !isStr(r.en)) return `verse link ${r.verseId} is missing its text`;
  }
  if (w.srs !== undefined) {
    const s = w.srs;
    if (!isObj(s) || !isNum(s.interval) || !isNum(s.ease) || !isNum(s.reps) || !Array.isArray(s.history)) return "malformed review state";
    for (const h of s.history) if (!isObj(h) || !isStr(h.at) || !["got", "almost", "forgot"].includes(h.result)) return "malformed review answer";
  }
  return null;
}
function checkHighlight(h: any): string | null {
  if (!isObj(h)) return "not an object";
  if (!isStr(h.id) || !isStr(h.verseId) || !VERSE_ID.test(h.verseId)) return "missing id or verseId";
  if (!isNum(h.start) || !isNum(h.end) || h.end <= h.start) return "bad position";
  if (!(HIGHLIGHT_COLORS as readonly string[]).includes(h.color)) return `unknown colour ${h.color}`;
  if (!isStr(h.text) || h.text.length !== h.end - h.start) return "text does not match position";
  return null;
}

export function parseBackup(input: unknown): ParsedBackup {
  const doc = typeof input === "string" ? JSON.parse(input) : input;
  if (!isObj(doc) || doc.format !== BACKUP_FORMAT) throw new Error("This is not a 读经 backup file.");
  if (doc.formatVersion !== BACKUP_VERSION) throw new Error(`Unsupported backup version ${doc.formatVersion}.`);
  const rejected: Rejected[] = [];
  const snap = emptySnapshot();
  const docs = isObj(doc.docs) ? doc.docs : {};
  const colls = isObj(doc.collections) ? doc.collections : {};
  const prefs = unwrap(docs.prefs), progress = unwrap(docs.progress);
  if (isObj(prefs)) snap.settings = prefs as ReadingSettings;
  if (isObj(progress)) {
    if (!isObj(progress.books)) rejected.push({ kind: "progress", id: null, reason: "malformed reading progress" });
    else snap.progress = { books: progress.books, last: isObj(progress.last) ? (progress.last as any) : null };
  }
  for (const raw of Array.isArray(colls.vocab) ? colls.vocab : []) {
    const w = unwrap(raw), why = checkWord(w);
    if (why) rejected.push({ kind: "word", id: isObj(w) ? (w.id ?? null) : null, reason: why }); else snap.words.push(w as VocabWord);
  }
  for (const raw of Array.isArray(colls.highlights) ? colls.highlights : []) {
    const h = unwrap(raw), why = checkHighlight(h);
    if (why) rejected.push({ kind: "highlight", id: isObj(h) ? (h.id ?? null) : null, reason: why }); else snap.highlights.push(h as Highlight);
  }
  for (const raw of Array.isArray(colls.bookmarks) ? colls.bookmarks : []) {
    const b = unwrap(raw);
    if (!isObj(b) || !isStr(b.verseId) || !VERSE_ID.test(b.verseId)) rejected.push({ kind: "bookmark", id: null, reason: "missing verseId" });
    else snap.bookmarks.push(b as Bookmark);
  }
  return { snapshot: snap, rejected, exportedAt: isStr(doc.exportedAt) ? doc.exportedAt : null, source: doc.source ?? null };
}

export function toBackup(snap: UserSnapshot, source: unknown = { app: "读经" }, now = new Date().toISOString()) {
  return {
    format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, exportedAt: now, source,
    docs: { prefs: { data: snap.settings }, progress: { data: snap.progress } },
    collections: {
      vocab: snap.words.map(data => ({ data })),
      highlights: snap.highlights.map(data => ({ data })),
      bookmarks: snap.bookmarks.map(data => ({ data })),
    },
  };
}

// ---------------------------------------------------------------- merging
export interface ImportReport {
  wordsAdded: number; wordsMerged: number; refsAdded: number; reviewAnswersAdded: number;
  highlightsAdded: number; bookmarksAdded: number;
  progressChanged: boolean; settingsImported: boolean;
  duplicatesSkipped: number;
}
export const isNoop = (r: ImportReport) =>
  !r.wordsAdded && !r.wordsMerged && !r.refsAdded && !r.reviewAnswersAdded && !r.highlightsAdded && !r.bookmarksAdded && !r.progressChanged && !r.settingsImported;

/** JSON with sorted keys, so equal data compares equal whatever the key order. */
export const canonical = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
const eventKey = (e: ReviewEvent) => `${e.at}|${e.result}`;
const latestAt = (s?: SrsState) => (s && s.history.length ? s.history[s.history.length - 1]!.at : "");
const minIso = (a: string, b: string) => (a && (!b || a < b) ? a : b);
const maxIso = (a: string, b: string) => (a > b ? a : b);

function mergeWord(cur: VocabWord, inc: VocabWord, rep: ImportReport): VocabWord {
  let changed = false;
  const refs: VocabRef[] = [...cur.refs];
  for (const r of inc.refs) {
    const i = refs.findIndex(x => x.verseId === r.verseId);
    if (i < 0) { refs.push(r); rep.refsAdded++; changed = true; }
    else { rep.duplicatesSkipped++; if (r.addedAt < refs[i]!.addedAt) { refs[i] = { ...refs[i]!, addedAt: r.addedAt }; changed = true; } }
  }
  let srs = cur.srs;
  if (inc.srs) {
    if (!cur.srs) { srs = inc.srs; rep.reviewAnswersAdded += inc.srs.history.length; changed = true; }
    else {
      const seen = new Set(cur.srs.history.map(eventKey));
      const extra = inc.srs.history.filter(e => !seen.has(eventKey(e)));
      rep.duplicatesSkipped += inc.srs.history.length - extra.length;
      if (extra.length) {
        const history = [...cur.srs.history, ...extra].sort((a, b) => a.at.localeCompare(b.at));
        const base = latestAt(inc.srs) > latestAt(cur.srs) ? inc.srs : cur.srs;   // schedule from whichever saw the latest answer
        srs = { ...base, history };
        rep.reviewAnswersAdded += extra.length; changed = true;
      }
    }
  }
  // legacy flashcard counters (from before spaced repetition): keep the larger
  let review = cur.review;
  if (inc.review) {
    const c = cur.review;
    const seen = Math.max(c?.seen ?? 0, inc.review.seen ?? 0), flips = Math.max(c?.flips ?? 0, inc.review.flips ?? 0);
    const lastSeen = [c?.lastSeen, inc.review.lastSeen].filter(Boolean).sort().pop() ?? null;
    if (!c || seen !== c.seen || flips !== c.flips || lastSeen !== c.lastSeen) {
      review = { ...(c ?? inc.review), seen, flips, lastSeen }; changed = true;
    }
  }
  const addedAt = minIso(cur.addedAt, inc.addedAt);
  if (addedAt !== cur.addedAt) changed = true;
  if (!changed) return cur;
  rep.wordsMerged++;
  const out: VocabWord = { ...cur, refs, addedAt, updatedAt: maxIso(cur.updatedAt, inc.updatedAt) };
  if (srs) out.srs = srs;
  if (review) out.review = review;
  return out;
}

function mergeProgress(cur: ReadingProgress | null, inc: ReadingProgress | null): ReadingProgress | null {
  if (!inc) return cur;
  if (!cur) return inc;
  const books: ReadingProgress["books"] = { ...cur.books };
  for (const [code, b] of Object.entries(inc.books)) {
    const c = books[code];
    books[code] = c ? { read: [...new Set([...c.read, ...b.read])].sort((x, y) => x - y), lastChapter: c.lastChapter ?? b.lastChapter } : b;
  }
  const last = !cur.last ? inc.last : !inc.last ? cur.last : inc.last.at > cur.last.at ? inc.last : cur.last;
  if (last && last !== cur.last && books[last.book]) books[last.book] = { ...books[last.book]!, lastChapter: last.chapter };
  return { books, last };
}

/**
 * Merge `incoming` into `existing`. Pure: returns the merged snapshot and a
 * report of exactly what was added. Settings are imported only when the
 * account has none yet (an account's own settings are never overwritten).
 */
export function planImport(incoming: UserSnapshot, existing: UserSnapshot = emptySnapshot()): { merged: UserSnapshot; report: ImportReport } {
  const rep: ImportReport = { wordsAdded: 0, wordsMerged: 0, refsAdded: 0, reviewAnswersAdded: 0, highlightsAdded: 0, bookmarksAdded: 0, progressChanged: false, settingsImported: false, duplicatesSkipped: 0 };
  const words = new Map(existing.words.map(w => [w.id, w]));
  for (const w of incoming.words) {
    const cur = words.get(w.id);
    if (!cur) { words.set(w.id, w); rep.wordsAdded++; rep.refsAdded += w.refs.length; rep.reviewAnswersAdded += w.srs?.history.length ?? 0; }
    else words.set(w.id, mergeWord(cur, w, rep));
  }
  const hls = new Map(existing.highlights.map(h => [h.id, h]));
  const pos = new Set(existing.highlights.map(h => `${h.verseId}|${h.start}|${h.end}|${h.color}`));
  for (const h of incoming.highlights) {
    const k = `${h.verseId}|${h.start}|${h.end}|${h.color}`;
    if (hls.has(h.id) || pos.has(k)) { rep.duplicatesSkipped++; continue; }
    hls.set(h.id, h); pos.add(k); rep.highlightsAdded++;
  }
  const bms = new Map(existing.bookmarks.map(b => [b.verseId, b]));
  for (const b of incoming.bookmarks) { if (bms.has(b.verseId)) { rep.duplicatesSkipped++; continue; } bms.set(b.verseId, b); rep.bookmarksAdded++; }
  let progress = mergeProgress(existing.progress, incoming.progress);
  if (canonical(progress) === canonical(existing.progress)) progress = existing.progress;
  rep.progressChanged = canonical(progress) !== canonical(existing.progress);
  let settings = existing.settings;
  if (!settings && incoming.settings) { settings = incoming.settings; rep.settingsImported = true; }
  return { merged: { settings, progress, words: [...words.values()], highlights: [...hls.values()], bookmarks: [...bms.values()] }, report: rep };
}
