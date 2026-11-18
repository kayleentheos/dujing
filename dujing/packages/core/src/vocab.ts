// Vocabulary records: one per word (word + pinyin), linked to every verse where
// it was saved. Pure functions — storage is the caller's job.
import { contextualMeaning, definitionOf } from "./dictionary";
import { answer, freshSrs } from "./srs";
import type { LexiconEntry, ReviewResult, VocabRef, VocabWord } from "./types";

export const wordId = (word: string, pinyin: string) => `${word}|${pinyin}`;
export const hasRef = (w: VocabWord | null | undefined, verseId: string) => !!w && w.refs.some(r => r.verseId === verseId);

export interface VerseContext { verseId: string; book: string; bookZh: string; bookEn: string; chapter: number; verse: number; zh: string; en: string }

export type SaveStatus = "created" | "attached" | "exists";

/** Save a word from a verse; if already saved, attach the verse instead (never a duplicate). */
export function saveWord(existing: VocabWord | null | undefined, entry: LexiconEntry, ctx: VerseContext, now = new Date().toISOString()): { record: VocabWord; status: SaveStatus } {
  const ref: VocabRef = { ...ctx, contextual: contextualMeaning(entry, ctx.verseId, ctx.en), addedAt: now };
  if (existing) {
    if (hasRef(existing, ctx.verseId)) return { record: existing, status: "exists" };
    return { record: { ...existing, refs: [...existing.refs, ref], updatedAt: now }, status: "attached" };
  }
  return {
    status: "created",
    record: {
      schema: 1, id: wordId(entry.w, entry.py), word: entry.w, pinyin: entry.py,
      trad: entry.trad ?? null, pos: entry.pos ?? null, senses: entry.senses ?? null,
      definition: definitionOf(entry), kind: entry.kind,
      firstRef: ctx.verseId, refs: [ref], addedAt: now, updatedAt: now,
      review: { seen: 0, flips: 0, lastSeen: null, history: [] },
    },
  };
}

/** Remove one verse link; returns null when it was the last one (the word should be deleted). */
export function detachRef(w: VocabWord, verseId: string, now = new Date().toISOString()): VocabWord | null {
  const refs = w.refs.filter(r => r.verseId !== verseId);
  if (!refs.length) return null;
  return { ...w, refs, firstRef: refs.some(r => r.verseId === w.firstRef) ? w.firstRef : refs[0]!.verseId, updatedAt: now };
}

export function recordAnswer(w: VocabWord, result: ReviewResult, now = Date.now()): VocabWord {
  return { ...w, srs: answer({ ...freshSrs(), ...(w.srs ?? {}) }, result, now), updatedAt: new Date(now).toISOString() };
}

export function resetProgress(w: VocabWord, now = new Date().toISOString()): VocabWord {
  const { srs: _drop, ...rest } = w;
  return { ...rest, updatedAt: now };
}
