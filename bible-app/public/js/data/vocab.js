// Personal vocabulary: one record per word (word + its pinyin), each linked to
// every Bible verse where the user saved it. Kept apart from the Bible text and
// the dictionary; persisted through the storage adapter (private cloud space +
// local copy).
//
// Record (schema 1):
// {
//   id: "生命|shēng mìng", word, pinyin, trad, pos, senses: [..], definition,
//   firstRef: "JHN.1.4",                  // where the word was first met
//   refs: [{ verseId, book, bookZh, bookEn, chapter, verse,
//            zh, en, contextual, addedAt }],   // one per attached verse
//   addedAt, updatedAt,
//   review: { seen, flips, lastSeen, history: [] }   // reserved for spaced repetition
// }
import * as storage from "../core/storage.js";

const COLL = "vocab";
storage.registerCollection(COLL);
const subs = new Set();

export const idFor = (word, pinyin) => `${word}|${pinyin}`;
export const all = () => storage.list(COLL).filter(r => r && r.id && r.refs);
export const get = id => storage.getItem(COLL, id);
export const isSaved = (word, pinyin) => !!get(idFor(word, pinyin));
export const hasRef = (rec, verseId) => !!rec && rec.refs.some(r => r.verseId === verseId);

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function changed() { subs.forEach(fn => fn()); }
export function notify() { changed(); }

/** Words saved from a given verse (for the verse → word direction). */
export function savedInVerse(verseId) { return all().filter(r => hasRef(r, verseId)); }

/**
 * Save a word from a verse. If the word is already saved, the verse is attached
 * to the existing record instead (no duplicates). Returns {record, status}
 * where status is "created" | "attached" | "exists".
 */
export async function save({ entry, ref }) {
  const id = idFor(entry.w, entry.py);
  const now = new Date().toISOString();
  const existing = get(id);
  const fullRef = { ...ref, addedAt: now };
  if (existing) {
    if (hasRef(existing, ref.verseId)) return { record: existing, status: "exists" };
    const rec = { ...existing, refs: [...existing.refs, fullRef], updatedAt: now };
    await storage.putItem(COLL, id, rec); changed();
    return { record: rec, status: "attached" };
  }
  const rec = {
    schema: 1, id, word: entry.w, pinyin: entry.py, trad: entry.trad || null,
    pos: entry.pos || null, senses: entry.senses || null,
    definition: definitionOf(entry),
    kind: entry.kind, firstRef: ref.verseId, refs: [fullRef],
    addedAt: now, updatedAt: now,
    review: { seen: 0, flips: 0, lastSeen: null, history: [] },
  };
  await storage.putItem(COLL, id, rec); changed();
  return { record: rec, status: "created" };
}

export async function detachRef(id, verseId) {
  const rec = get(id); if (!rec) return;
  const refs = rec.refs.filter(r => r.verseId !== verseId);
  if (!refs.length) return remove(id);
  await storage.putItem(COLL, id, { ...rec, refs, updatedAt: new Date().toISOString() }); changed();
}

export async function remove(id) {
  const rec = get(id);
  await storage.removeItem(COLL, id); changed();
  return rec;
}
export async function restore(rec) { await storage.putItem(COLL, rec.id, rec); changed(); }

export async function markSeen(id, flipped) {
  const rec = get(id); if (!rec) return;
  const r = { ...(rec.review || { seen: 0, flips: 0, history: [] }) };
  r.seen = (r.seen || 0) + (flipped ? 0 : 1);
  r.flips = (r.flips || 0) + (flipped ? 1 : 0);
  r.lastSeen = new Date().toISOString();
  await storage.putItem(COLL, id, { ...rec, review: r });
}

/** Plain-language definition from a dictionary entry (never invented). */
export function definitionOf(entry) {
  if (entry.senses && entry.senses.length) return entry.senses.slice(0, 3).join("; ");
  if (entry.kind === "name") return "Proper name (transliteration)";
  if (entry.kind === "transliteration" && entry.note) return entry.note.text.split(" — ")[0];
  if (entry.kind === "parts" && entry.parts) return entry.parts.map(p => `${p.w} ${p.senses && p.senses[0] ? p.senses[0] : "—"}`).join(" + ");
  return "Definition not available";
}

// ---- spaced repetition ------------------------------------------------------
import { answer as srsAnswer, fresh as srsFresh } from "./srs.js";

/** Record a study answer ("forgot" | "almost" | "got") and reschedule the word. */
export async function recordAnswer(id, result) {
  const rec = get(id); if (!rec) return null;
  const srs = srsAnswer({ ...srsFresh(), ...(rec.srs || {}) }, result);
  const next = { ...rec, srs, updatedAt: new Date().toISOString() };
  await storage.putItem(COLL, id, next); changed();
  return next;
}
export async function resetProgress(ids) {
  for (const id of ids) { const rec = get(id); if (rec) { const { srs: _drop, ...rest } = rec; await storage.putItem(COLL, id, { ...rest, updatedAt: new Date().toISOString() }); } }
  changed();
}
export async function removeMany(ids) {
  const recs = ids.map(get).filter(Boolean);
  for (const r of recs) await storage.removeItem(COLL, r.id);
  changed();
  return recs;
}
export async function restoreMany(recs) { for (const r of recs) await storage.putItem(COLL, r.id, r); changed(); }
