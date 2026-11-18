// The storage interface. Every backend (in-memory for tests, Supabase in the
// web and mobile apps) implements this; services never talk to a database
// directly. All methods are scoped to the signed-in user by the backend —
// callers never pass a user id, so one user can't ask for another's data.
import type { Bookmark, Highlight, ReadingProgress, ReadingSettings, VocabWord } from "@dujing/core";

export interface UserDataStore {
  vocab: {
    list(): Promise<VocabWord[]>;
    get(id: string): Promise<VocabWord | null>;
    put(words: VocabWord[]): Promise<void>;          // insert or replace by id
    remove(ids: string[]): Promise<void>;
  };
  highlights: {
    list(filter?: { book?: string; chapter?: number }): Promise<Highlight[]>;
    put(items: Highlight[]): Promise<void>;
    remove(ids: string[]): Promise<void>;
  };
  bookmarks: {
    list(): Promise<Bookmark[]>;
    put(items: Bookmark[]): Promise<void>;
    remove(ids: string[]): Promise<void>;
  };
  settings: { get(): Promise<ReadingSettings | null>; set(s: ReadingSettings): Promise<void> };
  progress: { get(): Promise<ReadingProgress | null>; set(p: ReadingProgress): Promise<void> };
}

/** An in-memory store: used by tests, and as the shape reference for real backends. */
export function memoryStore(): UserDataStore & { dump(): unknown } {
  const vocab = new Map<string, VocabWord>(), hls = new Map<string, Highlight>(), bms = new Map<string, Bookmark>();
  let settings: ReadingSettings | null = null, progress: ReadingProgress | null = null;
  const clone = <T>(x: T): T => structuredClone(x);
  return {
    vocab: {
      async list() { return [...vocab.values()].map(clone); },
      async get(id) { const w = vocab.get(id); return w ? clone(w) : null; },
      async put(ws) { for (const w of ws) vocab.set(w.id, clone(w)); },
      async remove(ids) { for (const id of ids) vocab.delete(id); },
    },
    highlights: {
      async list(f = {}) { return [...hls.values()].filter(h => (!f.book || h.book === f.book) && (f.chapter == null || h.chapter === f.chapter)).map(clone); },
      async put(items) { for (const h of items) hls.set(h.id, clone(h)); },
      async remove(ids) { for (const id of ids) hls.delete(id); },
    },
    bookmarks: {
      async list() { return [...bms.values()].map(clone); },
      async put(items) { for (const b of items) bms.set(b.id, clone(b)); },
      async remove(ids) { for (const id of ids) bms.delete(id); },
    },
    settings: { async get() { return settings && clone(settings); }, async set(s) { settings = clone(s); } },
    progress: { async get() { return progress && clone(progress); }, async set(p) { progress = clone(p); } },
    dump: () => ({ vocab: [...vocab.values()], highlights: [...hls.values()], bookmarks: [...bms.values()], settings, progress }),
  };
}
