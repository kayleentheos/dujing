// Application services: the operations screens call. Pure rules come from
// @dujing/core; this layer loads, applies and saves through a UserDataStore.
import {
  buildSession, detachRef, emptySnapshot, groupOf, paint, parseBackup, planImport, recordAnswer, resetProgress, saveWord, toBackup,
  type Bookmark, type HighlightColor, type VocabWord, type LexiconEntry, type PaintRange, type ReadingProgress, type ReviewResult, type UserSnapshot, type VerseContext,
} from "@dujing/core";
import type { UserDataStore } from "./store";

type Listener = () => void;

export function createServices(store: UserDataStore) {
  const listeners = new Set<Listener>();
  const changed = () => listeners.forEach(fn => fn());
  const subscribe = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

  const vocab = {
    list: () => store.vocab.list(),
    get: (id: string) => store.vocab.get(id),
    async save(entry: LexiconEntry, ctx: VerseContext) {
      const res = saveWord(await store.vocab.get(`${entry.w}|${entry.py}`), entry, ctx);
      if (res.status !== "exists") { await store.vocab.put([res.record]); changed(); }
      return res;
    },
    async detach(id: string, verseId: string) {
      const w = await store.vocab.get(id); if (!w) return;
      const next = detachRef(w, verseId);
      if (next) await store.vocab.put([next]); else await store.vocab.remove([id]);
      changed();
    },
    async remove(ids: string[]) {
      const gone = (await Promise.all(ids.map(id => store.vocab.get(id)))).filter((w): w is VocabWord => !!w);
      await store.vocab.remove(ids); changed();
      return gone;                                   // for Undo
    },
    async restore(words: VocabWord[]) { await store.vocab.put(words); changed(); },
    async resetProgress(ids: string[]) {
      const ws = (await Promise.all(ids.map(id => store.vocab.get(id)))).filter(Boolean).map(w => resetProgress(w!));
      await store.vocab.put(ws); changed();
    },
  };

  const study = {
    async session(opts?: Parameters<typeof buildSession>[1]) { return buildSession(await store.vocab.list(), opts); },
    async answer(id: string, result: ReviewResult, now = Date.now()) {
      const w = await store.vocab.get(id); if (!w) return null;
      const next = recordAnswer(w, result, now);
      await store.vocab.put([next]); changed();
      return next;
    },
  };

  const highlights = {
    list: (f?: { book?: string; chapter?: number }) => store.highlights.list(f),
    async paint(ranges: PaintRange[], color: HighlightColor | null) {
      const verses = new Set(ranges.map(r => r.verseId));
      const existing = (await store.highlights.list()).filter(h => verses.has(h.verseId));
      const r = paint(existing, ranges, color);
      if (r.remove.length) await store.highlights.remove(r.remove.filter(id => !r.put.some(p => p.id === id)));
      if (r.put.length) await store.highlights.put(r.put);
      changed();
      return r.created;
    },
    async setColor(id: string, color: HighlightColor) {
      const all = await store.highlights.list(); const h = all.find(x => x.id === id); if (!h) return;
      const now = new Date().toISOString();
      await store.highlights.put(groupOf(all, h).map(x => ({ ...x, color, updatedAt: now }))); changed();
    },
    async remove(id: string) {
      const all = await store.highlights.list(); const h = all.find(x => x.id === id); if (!h) return [];
      const group = groupOf(all, h);
      await store.highlights.remove(group.map(x => x.id)); changed();
      return group;
    },
  };

  const bookmarks = {
    list: () => store.bookmarks.list(),
    async toggle(verseId: string, label: string | null = null) {
      const all = await store.bookmarks.list();
      const hit = all.find(b => b.verseId === verseId);
      if (hit) { await store.bookmarks.remove([hit.id]); changed(); return null; }
      const [book, c, v] = verseId.split("."); const now = new Date().toISOString();
      const b: Bookmark = { id: verseId, verseId, book: book!, chapter: +c!, verse: +v!, label, createdAt: now, updatedAt: now };
      await store.bookmarks.put([b]); changed(); return b;
    },
  };

  const reading = {
    getSettings: () => store.settings.get(),
    setSettings: async (s: Parameters<typeof store.settings.set>[0]) => { await store.settings.set(s); changed(); },
    getProgress: () => store.progress.get(),
    async setPosition(book: string, chapter: number, verse: number | null, at = Date.now()) {
      const p: ReadingProgress = (await store.progress.get()) ?? { books: {}, last: null };
      const b = p.books[book] ?? { read: [], lastChapter: null };
      p.books[book] = { ...b, lastChapter: chapter }; p.last = { book, chapter, verse, at };
      await store.progress.set(p);
    },
    async markChapterRead(book: string, chapter: number) {
      const p: ReadingProgress = (await store.progress.get()) ?? { books: {}, last: null };
      const b = p.books[book] ?? { read: [], lastChapter: null };
      if (!b.read.includes(chapter)) p.books[book] = { ...b, read: [...b.read, chapter].sort((x, y) => x - y) };
      await store.progress.set(p); changed();
    },
  };

  const backup = {
    async snapshot(): Promise<UserSnapshot> {
      const [settings, progress, words, hls, bms] = await Promise.all([store.settings.get(), store.progress.get(), store.vocab.list(), store.highlights.list(), store.bookmarks.list()]);
      return { ...emptySnapshot(), settings, progress, words, highlights: hls, bookmarks: bms };
    },
    async export(source: unknown = { app: "读经 web" }) { return toBackup(await backup.snapshot(), source); },
    /** Preview an import without changing anything. */
    async preview(file: unknown) {
      const parsed = parseBackup(file);
      return { ...planImport(parsed.snapshot, await backup.snapshot()), rejected: parsed.rejected };
    },
    /** Import a backup: only additions and merges are written; running it again changes nothing. */
    async import(file: unknown) {
      const parsed = parseBackup(file);
      const before = await backup.snapshot();
      const { merged, report } = planImport(parsed.snapshot, before);
      const beforeWords = new Map(before.words.map(w => [w.id, w]));
      const words = merged.words.filter(w => beforeWords.get(w.id) !== w);
      const prevH = new Set(before.highlights.map(h => h.id)), prevB = new Set(before.bookmarks.map(b => b.id));
      if (words.length) await store.vocab.put(words);
      const hs = merged.highlights.filter(h => !prevH.has(h.id)); if (hs.length) await store.highlights.put(hs);
      const bs = merged.bookmarks.filter(b => !prevB.has(b.id)); if (bs.length) await store.bookmarks.put(bs);
      if (report.progressChanged && merged.progress) await store.progress.set(merged.progress);
      if (report.settingsImported && merged.settings) await store.settings.set(merged.settings);
      changed();
      return { report, rejected: parsed.rejected };
    },
  };

  return { subscribe, vocab, study, highlights, bookmarks, reading, backup };
}
export type Services = ReturnType<typeof createServices>;
