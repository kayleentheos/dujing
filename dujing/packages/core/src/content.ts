// Bible content repository. It never knows where files come from: the web app
// passes a fetch-based source, a mobile app can pass one that reads bundled
// assets, tests pass one that reads from disk. Adding a book or translation is
// a data change, not a code change.
import type { Alignment, Annotations, Canon, CanonBook, ChapterRow, ChapterView, Lexicon, TranslationBook, TranslationMeta, Verse, VerseId } from "./types";

// fetch exists in browsers, React Native and Node 18+; declared minimally so core needs no DOM types.
declare const fetch: (url: string, init?: unknown) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ContentSource {
  /** Read a JSON file by its path relative to the content root, e.g. "canon.json". */
  getJSON<T>(path: string): Promise<T>;
}

/** A ContentSource over fetch(), e.g. fetchSource("/content/"). */
export function fetchSource(base: string, init?: unknown): ContentSource {
  return {
    async getJSON<T>(path: string) {
      const r = await fetch(base + path, init);
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return (await r.json()) as T;
    },
  };
}


export interface Reference { book: string; chapter: number; verse: number | null; available: boolean }
export interface SearchHit { book: CanonBook; tid: "cuv" | "web"; verse: Verse; at: number; len: number }

export function createBibleRepo(source: ContentSource) {
  const cache = new Map<string, Promise<unknown>>();
  const indexes = new WeakMap<TranslationBook, Map<VerseId, Verse>>();
  const json = <T>(path: string): Promise<T> => {
    if (!cache.has(path)) cache.set(path, source.getJSON<T>(path).catch(e => { cache.delete(path); throw e; }));
    return cache.get(path) as Promise<T>;
  };
  const indexOf = (doc: TranslationBook) => {
    let ix = indexes.get(doc);
    if (!ix) { ix = new Map(); for (const vs of Object.values(doc.chapters)) for (const v of vs) ix.set(v.id, v); indexes.set(doc, ix); }
    return ix;
  };

  const canon = () => json<Canon>("canon.json");
  const lexicon = (code: string) => json<Lexicon>(`lexicon/${code}.json`);
  const translationMeta = (id: string) => json<TranslationMeta>(`translations/${id}/meta.json`);
  const translationBook = (tid: string, code: string) => json<TranslationBook>(`translations/${tid}/${code}.json`);
  const annotations = (tid: string, code: string) => json<Annotations>(`annotations/${tid}/${code}.json`).catch(() => null);

  async function bookInfo(code: string) { return (await canon()).books.find(b => b.code === code) ?? null; }

  /** One chapter assembled into aligned rows (CUV ↔ WEB), with word tokens. */
  async function chapter(code: string, ch: number, { zh = "cuv", en = "web" } = {}): Promise<ChapterView> {
    const [info, zb, eb, al, ann] = await Promise.all([
      bookInfo(code), translationBook(zh, code), translationBook(en, code), json<Alignment>(`alignment/${code}.json`), annotations(zh, code),
    ]);
    if (!info) throw new Error(`Unknown book ${code}`);
    const zix = indexOf(zb), eix = indexOf(eb);
    const inCh = (id: string) => +id.split(".")[1]! === ch;
    const rows: ChapterRow[] = [];
    for (const r of al.rows) {
      const zIds = r.cuv.filter(inCh), eIds = r.web.filter(inCh);
      if (!zIds.length && !eIds.length) continue;
      rows.push({
        key: eIds[0] ?? zIds[0]!,
        zh: zIds.map(id => ({ ...zix.get(id)!, tokens: ann ? ann.verses[id] ?? null : null })),
        en: eIds.map(id => eix.get(id)!),
        note: r.note ?? null,
        partial: !!r.note && (zIds.length !== r.cuv.length || eIds.length !== r.web.length),
      });
    }
    return { book: info, chapter: ch, rows, bands: ann ? ann.bands : {}, hasTokens: !!ann };
  }

  async function verse(tid: string, id: VerseId) {
    const code = id.split(".")[0]!;
    return indexOf(await translationBook(tid, code)).get(id) ?? null;
  }

  /** "John 3:16", "约翰福音 3:16", "jn 3", "约 3：16" → a reference, or null. */
  async function parseReference(q: string): Promise<Reference | null> {
    const c = await canon();
    const s = q.trim().replace(/[：﹕]/g, ":").replace(/\s+/g, " ");
    const m = s.match(/^(.*?)[\s.]*(\d+)(?:[:.\s](\d+))?$/);
    if (!m) return null;
    const raw = m[1]!.trim(), name = raw.toLowerCase();
    if (!name) return null;
    let book = c.books.find(b => b.code.toLowerCase() === name || b.name.en.toLowerCase() === name || b.name.zh === raw ||
      (b.name.en.toLowerCase().startsWith(name) && name.length >= 3));
    if (!book) book = c.books.find(b => (b.abbr ?? []).includes(raw));   // 约, 可, 林前 … from canon.json
    if (!book) return null;
    let chapterN = +m[2]!, verseN = m[3] ? +m[3] : null;
    // one-chapter books (Obadiah, Philemon, 2–3 John, Jude): "3 John 4" means verse 4
    if (book.chapters === 1 && !m[3] && chapterN > 1) { verseN = chapterN; chapterN = 1; }
    if (chapterN < 1 || chapterN > book.chapters) return null;
    return { book: book.code, chapter: chapterN, verse: verseN, available: !!book.imported };
  }

  /** Plain-text search in both translations of every imported book. */
  async function search(q: string, { limit = 200 } = {}): Promise<SearchHit[]> {
    const needle = q.trim(); if (!needle) return [];
    const lower = needle.toLowerCase();
    const out: SearchHit[] = [];
    for (const b of (await canon()).books.filter(b => b.imported)) {
      for (const tid of ["cuv", "web"] as const) {
        for (const v of indexOf(await translationBook(tid, b.code)).values()) {
          const i = (tid === "web" ? v.text.toLowerCase() : v.text).indexOf(tid === "web" ? lower : needle);
          if (i >= 0) out.push({ book: b, tid, verse: v, at: i, len: needle.length });
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }

  return { canon, lexicon, translationMeta, bookInfo, chapter, verse, parseReference, search };
}
export type BibleRepo = ReturnType<typeof createBibleRepo>;

/** "JHN.3.16" → { book, chapter, verse } */
export function splitVerseId(id: VerseId) {
  const [book, c, v] = id.split(".");
  return { book: book!, chapter: Number(c), verse: Number(v) };
}
