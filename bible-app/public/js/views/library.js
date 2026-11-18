// Home: the Scripture library.
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as repo from "../data/repo.js";
import * as store from "../core/store.js";
import { go } from "../core/router.js";
import * as vocab from "../data/vocab.js";
import * as highlights from "../data/highlights.js";

const PLANS = [
  { id: "john21", title: "The Gospel of John in 21 days", zh: "二十一天读约翰福音", desc: "One chapter a day, 约翰福音 1–21.", book: "JHN", days: 21 },
  { id: "mark16", title: "The Gospel of Mark in 16 days", zh: "十六天读马可福音", desc: "One chapter a day, 马可福音 1–16.", book: "MRK", days: 16 },
  { id: "1john5", title: "1 John in 5 days", zh: "五天读约翰一书", desc: "One chapter a day, 约翰一书 1–5.", book: "1JN", days: 5 },
  { id: "daily", title: "Daily Bible reading", zh: "每日读经", desc: "A passage each day across the whole Bible." },
  { id: "chrono", title: "Chronological Bible", zh: "按年代读经", desc: "The Bible in the order events happened." },
  { id: "year", title: "Bible in a year", zh: "一年读完圣经", desc: "Old and New Testament, 365 readings." },
  { id: "custom", title: "Custom plan", zh: "自订计划", desc: "Choose your own books and pace." },
];

export async function renderLibrary(root) {
  const [canon, cuvMeta, webMeta] = await Promise.all([repo.canon(), repo.translationMeta("cuv"), repo.translationMeta("web")]);
  const progress = store.get("progress");
  const page = h("main.page");

  // ---------- folio line
  page.append(h("div.folio",
    h("h1.folio__title", "The Scripture Library", h("span.zh", "圣经书库")),
    h("span.folio__meta", "Learn Chinese through Scripture")));

  // ---------- search
  const input = h("input", { type: "search", placeholder: "Search a word, phrase or reference — 恩典 · grace · John 3:16", "aria-label": "Search the Bible", enterkeyhint: "search" });
  page.append(h("form.searchbar", { onsubmit: e => { e.preventDefault(); const q = input.value.trim(); if (q) { sessionStorage.setItem("dujing:q", q); go({ name: "search" }); } } }, icon("search"), input));

  // ---------- 01 continue reading
  const last = progress.last;
  const target = last && canon.books.find(b => b.code === last.book && b.imported) ? last : { book: "JHN", chapter: 1, verse: null };
  const info = canon.books.find(b => b.code === target.book);
  const done = (progress.books[target.book]?.read || []).length;
  const pct = Math.round(100 * done / info.chapters);
  const preview = h("p.continue__verse");
  const cont = h("section.section",
    head("01", last ? "Continue Reading" : "Begin Reading", last ? "继续阅读" : "开始阅读",
      last ? `last opened ${timeAgo(last.at)}` : null),
    h("div.continue",
      h("div",
        h("div.continue__book", info.name.zh),
        h("div.continue__ref", `${info.name.en} ${target.chapter}${target.verse ? ":" + target.verse : ""} `, h("em", `· 第${target.chapter}章`)),
        preview),
      h("div.continue__side",
        h("div.continue__stats", h("span", `${done} of ${info.chapters} chapters read`), h("span", pct + "%")),
        h("div.progress", h("i", { style: { width: pct + "%" } })),
        h("a.btn.btn--primary", { href: `#read-${target.book}-${target.chapter}${target.verse ? "-" + target.verse : ""}` },
          last ? "Continue reading" : "Begin reading", icon("next")))));
  page.append(cont);
  repo.chapter(target.book, target.chapter).then(ch => {
    const row = ch.rows.find(r => r.zh[0] && (!target.verse || r.zh[0].v === target.verse)) || ch.rows[0];
    const z = row.zh[0], e = row.en[0];
    if (z) preview.append(h("span.zh", z.text), e ? h("span.en", e.text) : null);
  }).catch(() => { });

  // ---------- 02 browse
  const browse = h("section.section", head("02", "Browse the Bible", "圣经目录", `${canon.books.filter(b => b.imported).length} of 66 books available`));
  const cols = h("div.testaments");
  for (const [t, en, zh] of [["OT", "Old Testament", "旧约"], ["NT", "New Testament", "新约"]]) {
    const col = h("div.testament", h("h3.testament__title", en, h("span.zh", zh)));
    for (const cat of canon.categories.filter(c => c.testament === t)) {
      const list = h("ul.booklist");
      for (const code of cat.books) {
        const b = canon.books.find(x => x.code === code);
        const read = (progress.books[code]?.read || []).length;
        const inner = [
          h("span.bookrow__names", h("span.bookrow__zh", b.name.zh), h("span.bookrow__en", b.name.en)),
          h("span.bookrow__ch", b.imported ? (read ? `${read}/${b.chapters} read` : `${b.chapters} ch`) : h("span", h("span.bookrow__badge", "in preparation"), `${b.chapters} ch`)),
        ];
        list.append(h("li", b.imported
          ? h("a.bookrow.is-available", { href: `#book-${code}` }, inner)
          : h("div.bookrow.is-unavailable", { title: "Not yet imported" }, inner)));
      }
      col.append(h("div.category", h("div.category__name", h("span.smallcaps", cat.name.en), h("span.zh", cat.name.zh)), list));
    }
    cols.append(col);
  }
  browse.append(cols);
  page.append(browse);

  // ---------- 03 reading plans
  const plans = h("div.ledger");
  for (const p of PLANS) {
    if (p.book) {
      const bk = canon.books.find(b => b.code === p.book);
      if (!bk || !bk.imported) continue;
      const read = progress.books[p.book]?.read || [];
      const days = h("div.plan-days", Array.from({ length: p.days }, (_, i) => h("i", { class: read.includes(i + 1) ? "done" : "", title: `Day ${i + 1}: ${bk.name.en} ${i + 1}` })));
      const next = Array.from({ length: p.days }, (_, i) => i + 1).find(d => !read.includes(d)) || 1;
      plans.append(h("a.ledger__item", { href: `#read-${p.book}-${next}` },
        h("div.ledger__title", h("span", p.title), h("span.count", `${read.length}/${p.days}`)),
        h("p.ledger__desc", h("span.zh", p.zh), " · ", read.length >= p.days ? "Complete." : `Next: day ${next}, ${bk.name.en} ${next}.`), days));
    } else {
      plans.append(h("div.ledger__item.is-later",
        h("div.ledger__title", h("span", p.title), h("span.ledger__later", "needs more books")),
        h("p.ledger__desc", h("span.zh", p.zh), " · ", p.desc)));
    }
  }
  page.append(h("section.section", head("03", "Reading Plans", "读经计划"), plans));

  // ---------- 04 notebook
  const nb = h("div.ledger",
    vocabItem(),
    nbItem("Bookmarked verses", "书签", "Verses you mark to return to.", "#study", "phase-4"),
    nbItem("Personal annotations", "笔记", "Reflections attached to verses, searchable by book.", "#study", "phase-4"),
    hlItem(),
    h("a.ledger__item", { href: "#backup" }, h("div.ledger__title", h("span", "Back up my data")), h("p.ledger__desc", h("span.zh", "备份"), " · Download a complete copy of your words, review history, highlights, settings and progress.")));
  page.append(h("section.section", head("04", "My Notebook", "我的笔记本"), nb));

  // ---------- colophon (translation credits)
  page.append(h("footer.colophon",
    h("span", h("span.zh", cuvMeta.name.zh), " — ", cuvMeta.license.status, " · ", webMeta.name.en, " — ", webMeta.license.status),
    h("a", { href: "#about" }, "Sources, licensing & editions")));

  root.replaceChildren(page);
}

function head(num, title, zh, aside) {
  return h("div.section__head", h("span.section__num", num), h("h2.section__title", title, h("span.zh", zh)), aside ? h("span.section__aside", aside) : null);
}

function vocabItem() {
  const all = vocab.all();
  const links = all.reduce((n, r) => n + r.refs.length, 0);
  return h("a.ledger__item", { href: "#vocab" },
    h("div.ledger__title", h("span", "Saved vocabulary"), h("span.count", all.length ? `${all.length} words` : "")),
    h("p.ledger__desc", h("span.zh", "生词本"), " · ", all.length ? `${links} verse links · review with flashcards.` : "Tap any word while reading and choose Add to Vocabulary."));
}

function hlItem() {
  const n = highlights.all().length;
  return h("a.ledger__item", { href: "#highlights" },
    h("div.ledger__title", h("span", "Highlights"), h("span.count", n ? `${n} passage${n > 1 ? "s" : ""}` : "")),
    h("p.ledger__desc", h("span.zh", "标记"), " · ", n ? "Every passage you have marked, by book and chapter." : "Select Chinese text while reading (or tap a word) to highlight it in one of six colours."));
}

function nbItem(title, zh, desc, href, phase) {
  // Phase 3/4 features: shown honestly as not yet built
  return h("div.ledger__item.is-later", { "data-href": href },
    h("div.ledger__title", h("span", title), h("span.ledger__later", phase === "phase-3" ? "coming in phase 3" : "coming in phase 4")),
    h("p.ledger__desc", h("span.zh", zh), " · ", desc));
}

function timeAgo(t) {
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
