// Highlight geometry. A highlight covers [start, end) characters of one verse
// and always snaps to whole words; a selection across verses becomes one
// highlight per verse sharing a groupId. Painting a range trims overlapping
// highlights of other colours and merges touching ones of the same colour.
import type { Highlight, HighlightColor, Token, VerseId } from "./types";
import { isWord } from "./types";
import { splitVerseId } from "./content";

const LEAD = /[\s　，。；：、！？「」『』（）]/;
const TRAIL = /[\s　，；：、「」『』（]/;

/** Don't start or end a highlight on spaces or punctuation. */
export function trimRange(text: string, start: number, end: number): [number, number] {
  let s = start, e = end;
  while (s < e && LEAD.test(text[s]!)) s++;
  while (e > s && TRAIL.test(text[e - 1]!)) e--;
  return [s, e];
}

/** Character offset of every token in a verse (tokens concatenate to the verse text). */
export function tokenOffsets(tokens: Token[]) {
  const out: { i: number; start: number; end: number; text: string; word: boolean }[] = [];
  let pos = 0, i = 0;
  for (const t of tokens) {
    if (!isWord(t)) continue;
    out.push({ i: i++, start: pos, end: pos + t[0].length, text: t[0], word: true });
    pos += t[0].length;
  }
  return out;
}

/** Widen [start, end) so it begins and ends on whole tokens. */
export function snapToTokens(tokens: Token[], start: number, end: number): [number, number] {
  const offs = tokenOffsets(tokens);
  const first = offs.find(t => t.end > start), last = [...offs].reverse().find(t => t.start < end);
  return [first ? Math.min(start, first.start) : start, last ? Math.max(end, last.end) : end];
}

export interface PaintRange { verseId: VerseId; start: number; end: number; verseText: string }
export interface PaintResult { put: Highlight[]; remove: string[]; created: Highlight[] }

/**
 * Paint ranges with a colour (or clear them when color is null), given the
 * highlights that already exist. Pure: returns what to store and delete.
 */
export function paint(existing: Highlight[], ranges: PaintRange[], color: HighlightColor | null,
  { now = new Date().toISOString(), newId = defaultId }: { now?: string; newId?: () => string } = {}): PaintResult {
  const groupId = ranges.length > 1 && color ? newId() : null;
  const live = new Map(existing.map(h => [h.id, h]));
  const put = new Map<string, Highlight>(), remove = new Set<string>(), created: Highlight[] = [];
  for (const r of ranges) {
    let [s, e] = trimRange(r.verseText, r.start, r.end);
    if (e <= s) continue;
    for (const h of [...live.values()].filter(h => h.verseId === r.verseId).sort((a, b) => a.start - b.start)) {
      if (h.end < s || h.start > e) continue;
      const touches = h.end === s || h.start === e;
      if (touches && h.color !== color) continue;
      live.delete(h.id); put.delete(h.id); remove.add(h.id);
      if (h.color === color) { s = Math.min(s, h.start); e = Math.max(e, h.end); continue; }
      const keep = (id: string, a: number, b: number) => {
        [a, b] = trimRange(r.verseText, a, b);
        if (b > a) { const piece = { ...h, id, start: a, end: b, text: r.verseText.slice(a, b), updatedAt: now }; live.set(id, piece); put.set(id, piece); remove.delete(id); }
      };
      if (h.start < s) keep(h.id + "a", h.start, s);
      if (h.end > e) keep(h.id + "b", e, h.end);
    }
    if (!color) continue;
    const { book, chapter, verse } = splitVerseId(r.verseId);
    const rec: Highlight = { schema: 1, id: newId(), book, chapter, verse, verseId: r.verseId, start: s, end: e, text: r.verseText.slice(s, e), color, groupId, createdAt: now, updatedAt: now };
    live.set(rec.id, rec); put.set(rec.id, rec); created.push(rec);
  }
  return { put: [...put.values()], remove: [...remove], created };
}

/** The highlight covering a character offset in a verse, if any. */
export const highlightAt = (all: Highlight[], verseId: VerseId, offset: number) =>
  all.find(h => h.verseId === verseId && h.start <= offset && offset < h.end) ?? null;

/** All members of a highlight's multi-verse group (or just itself). */
export const groupOf = (all: Highlight[], h: Highlight) => (h.groupId ? all.filter(x => x.groupId === h.groupId) : [h]);

let counter = 0;
function defaultId() { return Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 7); }
