// User highlights in the Chinese text. One record per highlighted stretch of
// one verse; a selection across verses makes one record per verse sharing a
// groupId. Positions are character offsets into the verse's CUV text, always
// snapped to whole words, and the highlighted text itself is stored so a
// highlight can be checked (and shown in lists) without the Bible data.
//
// { schema:1, id, book, chapter, verse, verseId, start, end, text, color,
//   groupId, createdAt, updatedAt }
import * as storage from "../core/storage.js";

const COLL = "highlights";
storage.registerCollection(COLL);
export const COLORS = ["pink", "blue", "green", "yellow", "orange", "purple"];
export const COLOR_NAMES = { pink: "Pink", blue: "Blue", green: "Green", yellow: "Yellow", orange: "Orange", purple: "Purple" };
const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
const changed = () => subs.forEach(fn => fn());

export const all = () => storage.list(COLL).filter(r => r && r.id && r.verseId);
export const forVerse = verseId => all().filter(r => r.verseId === verseId).sort((a, b) => a.start - b.start);
export const forChapter = (book, chapter) => all().filter(r => r.book === book && r.chapter === chapter);
export const at = (verseId, offset) => forVerse(verseId).find(r => r.start <= offset && offset < r.end) || null;
// pieces left over after a partial removal shouldn't begin or end on spaces / punctuation
function trim(text, s, e) {
  while (s < e && /[\s\u3000，。；：、！？「」『』（）]/.test(text[s])) s++;
  while (e > s && /[\s\u3000，；：、「」『』（]/.test(text[e - 1])) e--;
  return [s, e];
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/**
 * Paint [start, end) of a verse with `color` (or clear it when color is null).
 * Existing highlights that overlap are trimmed so they keep their colour outside
 * the new range; pieces of the same colour that touch are merged.
 */
async function paintOne({ verseId, start, end, color, verseText, groupId }) {
  const [book, ch, v] = verseId.split(".");
  const now = new Date().toISOString();
  let s = start, e = end;
  for (const r of forVerse(verseId)) {
    if (r.end < s || r.start > e) continue;
    const touches = r.end === s || r.start === e;
    if (touches && r.color !== color) continue;              // just adjacent, different colour: leave it
    await storage.removeItem(COLL, r.id);
    if (r.color === color) { s = Math.min(s, r.start); e = Math.max(e, r.end); continue; }   // same colour: merge
    const keep = async (id, a, b) => { [a, b] = trim(verseText, a, b); if (b > a) await storage.putItem(COLL, id, { ...r, id, start: a, end: b, text: verseText.slice(a, b), updatedAt: now }); };
    if (r.start < s) await keep(r.id + "a", r.start, s);
    if (r.end > e) await keep(r.id + "b", e, r.end);
  }
  if (!color) return null;
  const rec = { schema: 1, id: uid(), book, chapter: +ch, verse: +v, verseId, start: s, end: e, text: verseText.slice(s, e), color, groupId: groupId || null, createdAt: now, updatedAt: now };
  await storage.putItem(COLL, rec.id, rec);
  return rec;
}

/** ranges: [{ verseId, start, end, verseText }] — one per verse in the selection */
export async function paint(ranges, color) {
  const groupId = ranges.length > 1 ? uid() : null;
  const out = [];
  for (const r of ranges) out.push(await paintOne({ ...r, color, groupId }));
  changed();
  return out.filter(Boolean);
}
export const clear = ranges => paint(ranges, null);

/** Recolour or remove a whole highlight (and the rest of its multi-verse group). */
export async function setColor(id, color) {
  const rec = storage.getItem(COLL, id); if (!rec) return;
  const group = rec.groupId ? all().filter(r => r.groupId === rec.groupId) : [rec];
  for (const r of group) await storage.putItem(COLL, r.id, { ...r, color, updatedAt: new Date().toISOString() });
  changed();
}
export async function remove(id) {
  const rec = storage.getItem(COLL, id); if (!rec) return [];
  const group = rec.groupId ? all().filter(r => r.groupId === rec.groupId) : [rec];
  for (const r of group) await storage.removeItem(COLL, r.id);
  changed();
  return group;
}
export async function restore(recs) { for (const r of recs) await storage.putItem(COLL, r.id, r); changed(); }
export function notify() { changed(); }
