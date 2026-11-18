// Pronunciation of single words: short clips packed in sprite files
// (data/audio/<set>/words/<BOOK>-n.mp3) with an index of [file, start, end].
// Independent of the chapter player; pauses it while a word is spoken.
import * as player from "./player.js";

const SET = "azure-yunyang";
const BASE = `data/audio/${SET}/words/`;
const indexes = new Map(), blobs = new Map();
const el = new Audio();
let stopAt = 0, raf = 0;

async function index(book) {
  if (!indexes.has(book)) indexes.set(book, fetch(`${BASE}${book}.json`).then(r => (r.ok ? r.json() : null)).catch(() => { indexes.delete(book); return null; }));
  return indexes.get(book);
}
async function url(file) {
  if (!blobs.has(file)) blobs.set(file, fetch(BASE + file).then(r => { if (!r.ok) throw 0; return r.blob(); }).then(b => URL.createObjectURL(b)).catch(e => { blobs.delete(file); throw e; }));
  return blobs.get(file);
}
let books = null;
async function bookList() {
  if (!books) books = fetch(`${BASE}index.json`).then(r => (r.ok ? r.json() : { books: [] })).then(d => d.books || []).catch(() => { books = null; return []; });
  return books;
}
/** Each word is recorded once, under the first book it appeared in: look in this book, then the others. */
async function find(book, key) {
  for (const b of [book, ...(await bookList()).filter(x => x !== book)]) {
    const ix = await index(b); if (ix && ix.words[key]) return ix.words[key];
  }
  return null;
}
export async function hasWord(book, key) { return !!(await find(book, key)); }

/** Play the word `key` ("生命|shēng mìng") from `book`. Resolves false if unavailable. */
export async function playWord(book, key) {
  const w = await find(book, key);
  if (!w) return false;
  const [file, start, end] = w;
  if (player.snapshot().playing) player.pause();
  try {
    const u = await url(file);
    if (el.src !== u) el.src = u;
    el.currentTime = start; stopAt = end;
    await el.play();
    cancelAnimationFrame(raf);
    const watch = () => { if (el.currentTime >= stopAt) { el.pause(); return; } if (!el.paused) raf = requestAnimationFrame(watch); };
    raf = requestAnimationFrame(watch);
    return true;
  } catch { return false; }
}
globalThis.__dujingWordAudio = { el };
