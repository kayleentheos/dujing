// Book contents, search results and the sources/licensing page.
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as repo from "../data/repo.js";
import * as store from "../core/store.js";
import { go } from "../core/router.js";

export async function renderBook(root, code) {
  const info = await repo.bookInfo(code);
  if (!info) return go({ name: "home" }, { replace: true });
  const progress = store.get("progress");
  const read = progress.books[code]?.read || [];
  const current = progress.last?.book === code ? progress.last.chapter : null;
  const page = h("main.page",
    h("div.folio", h("h1.folio__title", info.name.en, h("span.zh", info.name.zh)), h("span.folio__meta", `${info.chapters} chapters · ${read.length} read`)));
  if (!info.imported) {
    page.append(h("p.notice", "This book has not been imported yet. Its text will be added from the same verified sources as the Gospel of John."));
  } else {
    const grid = h("nav.chapters", { "aria-label": "Chapters" });
    for (let c = 1; c <= info.chapters; c++) {
      grid.append(h("a", { href: `#read-${code}-${c}`, class: [read.includes(c) ? "is-read" : "", c === current ? "is-current" : ""].join(" ") },
        String(c), h("small", `第${c}章`)));
    }
    page.append(grid);
  }
  root.replaceChildren(page);
}

export async function renderSearch(root) {
  const q0 = sessionStorage.getItem("dujing:q") || "";
  const input = h("input", { type: "search", value: q0, placeholder: "Word, phrase or reference", "aria-label": "Search", enterkeyhint: "search" });
  const out = h("div");
  const page = h("main.page",
    h("div.folio", h("h1.folio__title", "Search", h("span.zh", "查找")), h("a.folio__meta", { href: "#home" }, "Back to library")),
    h("form.searchbar", { onsubmit: e => { e.preventDefault(); run(input.value); } }, icon("search"), input),
    out);
  root.replaceChildren(page);
  input.focus();

  async function run(q) {
    q = q.trim(); sessionStorage.setItem("dujing:q", q);
    out.replaceChildren();
    if (!q) return;
    const ref = await repo.parseReference(q);
    if (ref) {
      if (ref.available) return go({ name: "read", book: ref.book, chapter: ref.chapter, verse: ref.verse });
      out.append(h("p.notice", { style: { marginTop: "24px" } }, "That book has not been imported yet."));
      return;
    }
    const res = await repo.search(q);
    out.append(h("p.faint", { style: { margin: "18px 0 6px", fontSize: "13px" } },
      res.length ? `${res.length}${res.length >= 200 ? "+" : ""} verses contain “${q}”` : `No verses contain “${q}” in the imported books.`));
    const list = h("ul.results");
    for (const r of res) {
      const [, c, v] = r.verse.id.split(".");
      const t = r.verse.text;
      list.append(h("li.result", h("a", { href: `#read-${r.book.code}-${c}-${v}` },
        h("div.result__ref", `${r.book.name.zh} ${c}:${v} · ${r.book.name.en} ${c}:${v} · ${r.tid.toUpperCase()}`),
        h("div.result__text", { class: r.tid === "cuv" ? "zh" : "" }, t.slice(0, r.at), h("mark", t.slice(r.at, r.at + r.len)), t.slice(r.at + r.len)))));
    }
    out.append(list);
  }
  if (q0) run(q0);
}

export async function renderAbout(root) {
  const [cuv, web] = await Promise.all([repo.translationMeta("cuv"), repo.translationMeta("web")]);
  const block = m => h("div",
    h("h3", m.name.en, " ", m.name.zh ? h("span.zh", { style: { fontSize: ".85em", color: "var(--ink-faint)" } }, m.name.zh) : null),
    h("p", m.edition),
    h("dl",
      h("dt", "License"), h("dd", m.license.status, " — ", m.license.statement),
      h("dt", "Source"), h("dd", h("a", { href: m.source.page }, m.source.page)),
      ...m.source.files.flatMap(f => [h("dt", f.name), h("dd", h("code", f.sha256.slice(0, 16) + "…"), f.use ? ` (${f.use})` : ` · source dated ${f.sourceDated}`)]),
      h("dt", "Retrieved"), h("dd", m.source.retrieved),
      h("dt", "Changes"), h("dd", m.modifications),
      m.notExcluded ? [h("dt", "Note"), h("dd", m.notExcluded)] : null));
  root.replaceChildren(h("main.page",
    h("div.folio", h("h1.folio__title", "Sources & Licensing", h("span.zh", "版本说明")), h("a.folio__meta", { href: "#home" }, "Back to library")),
    h("article.prose",
      h("p", "Scripture in this app is imported, unaltered in wording, from official files published by eBible.org, and checked verse by verse against eBible’s independent verse-per-line edition. Nothing is generated or paraphrased."),
      block(cuv), block(web),
      h("h3", "Verse alignment"),
      h("p", "Chinese and English verses are joined through stable identifiers (for example JHN.3.16). Where the two editions number verses differently, the difference is recorded explicitly and shown in the reader: John 5:4 is absent from the CUV main text (given in its footnote at 5:3), and the CUV includes WEB 7:53 at the start of 8:1."),
      h("h3", "Pinyin and word division"),
      h("p", "Word division and pinyin are produced with jieba (MIT), CC-CEDICT (CC BY-SA 4.0, mdbg.net) and pypinyin (MIT), then corrected with a reviewed list of biblical words and context-dependent readings (for example 差 chāi “send”, 为 wéi in 称…为, adverbial 地 de). Pinyin shows dictionary (citation) tones."),
      h("h3", "Dictionary"),
      h("p", "Definitions come from CC-CEDICT (", h("a", { href: "https://www.mdbg.net/chinese/dictionary?page=cc-cedict" }, "mdbg.net"), "), licensed under Creative Commons Attribution-ShareAlike 4.0; release of 16 November 2026. Each word’s entry is chosen to match the pronunciation it has in that verse. Parts of speech come from the jieba dictionary’s tags (MIT), reviewed; where a tag is unreliable none is shown. Where a word is not in CC-CEDICT the app shows its dictionary parts or says the entry is unavailable — nothing is invented. Study notes on key words (marked “study note”) are editorial, written for this app; every Chinese and English phrase they quote is checked against the CUV and WEB text of John."),
      h("p", "Your saved vocabulary is stored privately in your own account space for this page (and a copy in this browser), separate from the Bible text and the dictionary."),
      h("h3", "Audio"),
      h("p", "Chapters with audio are read by a synthesized Mandarin voice (Microsoft Azure AI Speech, voice “Yunyang”), generated once, verse by verse, from the exact stored text — so the highlighted verse is always the verse being heard. The only differences from the printed text are that the respectful blank before 神 is not spoken, and that words whose reading depends on context (for example 差 chāi “send”, 找着 zhǎo zháo) are given their reviewed pinyin so the voice cannot misread them."),
      h("p", "Single-word pronunciation (the speaker button in the dictionary and on flashcards) uses the same voice. Each word was generated once; where the dictionary confirms the pinyin, that reading is forced so the voice says what is shown on screen (other words, mostly names, use the voice's own reading). A sample was checked by transcribing it back with Azure speech-to-text; names and rare words are still best confirmed by a Mandarin speaker."),
      h("p", "Each clip is checked automatically: it is transcribed back to text and its pinyin and tones are compared with the reviewed pinyin of the verse; clips that differ are flagged. Because a recogniser cannot catch every tone error, each chapter is marked “pronunciation not yet reviewed” until a Mandarin speaker has listened to it. This is a synthesized voice, not a human recording; a licensed recording can replace it later without changing the reader."))));
}
