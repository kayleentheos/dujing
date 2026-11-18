// Bible data repository. The interface never reads data files directly:
// everything goes through here, so adding a book or a translation is a data
// change (new JSON under data/), not a code change.
const BASE = "data/";
const cache = new Map();

async function json(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(BASE + path).then(r => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }).catch(e => { cache.delete(path); throw e; }));
  }
  return cache.get(path);
}

export const canon = () => json("canon.json");
export const lexicon = code => json(`lexicon/${code}.json`);
export const translationMeta = id => json(`translations/${id}/meta.json`);

export async function bookInfo(code) {
  const c = await canon();
  return c.books.find(b => b.code === code);
}

async function translationBook(tid, code) {
  const doc = await json(`translations/${tid}/${code}.json`);
  if (!doc._index) {
    doc._index = new Map();
    for (const vs of Object.values(doc.chapters)) for (const v of vs) doc._index.set(v.id, v);
  }
  return doc;
}

async function annotations(tid, code) {
  try { return await json(`annotations/${tid}/${code}.json`); }
  catch { return null; }   // a book can be readable before it is annotated
}

/**
 * One chapter, assembled into aligned rows:
 *   { book, chapter, rows: [{ key, zh:[verse], en:[verse], note, headings }] }
 * A verse object carries id, v, text, runs, notes, para, and (Chinese) tokens.
 */
export async function chapter(code, ch, { zh = "cuv", en = "web" } = {}) {
  const [info, zb, eb, al, ann] = await Promise.all([
    bookInfo(code), translationBook(zh, code), translationBook(en, code),
    json(`alignment/${code}.json`), annotations(zh, code),
  ]);
  const inCh = id => +id.split(".")[1] === ch;
  const rows = [];
  for (const r of al.rows) {
    const zIds = r.cuv.filter(inCh), eIds = r.web.filter(inCh);
    if (!zIds.length && !eIds.length) continue;
    const zhVerses = zIds.map(id => {
      const v = zb._index.get(id);
      return { ...v, tokens: ann ? ann.verses[id] : null };
    });
    const enVerses = eIds.map(id => eb._index.get(id));
    rows.push({
      key: (eIds[0] || zIds[0]),
      zh: zhVerses, en: enVerses,
      note: r.note || null,
      partial: !!r.note && (zIds.length !== r.cuv.length || eIds.length !== r.web.length),
    });
  }
  return { book: info, chapter: ch, rows, bands: ann ? ann.bands : {}, hasTokens: !!ann };
}

export async function chapterCount(code) {
  const info = await bookInfo(code);
  return info ? info.chapters : 0;
}

// ---- search ---------------------------------------------------------------
// Chinese abbreviations come from canon.json ("abbr", tools/build_canon.py)

export async function parseReference(q) {
  const c = await canon();
  const s = q.trim().replace(/[：﹕]/g, ":").replace(/\s+/g, " ");
  const m = s.match(/^(.*?)[\s.]*(\d+)(?:[:.\s](\d+))?$/);
  if (!m) return null;
  const name = m[1].trim().toLowerCase();
  let book = null;
  if (!name) book = null;
  else {
    book = c.books.find(b => b.code.toLowerCase() === name || b.name.en.toLowerCase() === name ||
      b.name.zh === m[1].trim() || b.name.en.toLowerCase().startsWith(name) && name.length >= 3);
    if (!book) book = c.books.find(b => (b.abbr || []).includes(m[1].trim()));
  }
  if (!book) return null;
  let chapter = +m[2], verse = m[3] ? +m[3] : null;
  // one-chapter books (Obadiah, Philemon, 2–3 John, Jude): "3 John 4" means verse 4
  if (book.chapters === 1 && !m[3] && chapter > 1) { verse = chapter; chapter = 1; }
  if (chapter < 1 || chapter > book.chapters) return null;
  return { book: book.code, chapter, verse, available: book.imported };
}

export async function search(q, { limit = 200 } = {}) {
  const c = await canon();
  const needle = q.trim();
  if (!needle) return [];
  const lower = needle.toLowerCase();
  const out = [];
  for (const b of c.books.filter(b => b.imported)) {
    const [zb, eb] = await Promise.all([translationBook("cuv", b.code), translationBook("web", b.code)]);
    for (const [tid, doc] of [["cuv", zb], ["web", eb]]) {
      for (const v of doc._index.values()) {
        const hay = tid === "web" ? v.text.toLowerCase() : v.text;
        const i = hay.indexOf(tid === "web" ? lower : needle);
        if (i >= 0) out.push({ book: b, tid, verse: v, at: i, len: needle.length });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
