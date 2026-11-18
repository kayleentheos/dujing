// The reader: immersive Chinese is the reading experience.
//  * tap / hover a word  -> dictionary popover (with Add to Vocabulary)
//  * tap a verse number (or its punctuation) -> that verse's English appears
//    underneath; tap again to hide. Several can be open; "Reveal all English"
//    opens every verse of the chapter.
import { h, $, $$, debounce, toast } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as repo from "../data/repo.js";
import * as store from "../core/store.js";
import * as vocab from "../data/vocab.js";
import { go } from "../core/router.js";
import { zhVerse, enVerse, notesBlock } from "../components/verse.js";
import { openSheet, closeSheet } from "../components/sheet.js";
import { openSettings } from "../components/settings.js";
import { attachWordPopover, close as closePopover, refresh as refreshPopover } from "../components/wordPopover.js";
import { attachHighlighter, paintHighlights } from "../components/highlighter.js";
import * as highlights from "../data/highlights.js";
import { playWord } from "../audio/wordAudio.js";
import * as player from "../audio/player.js";
import { trackFor, availableChapters } from "../audio/sources.js";
import { createAudioBar } from "../components/audioBar.js";

let cleanup = [];
export function leaveReader() { cleanup.forEach(f => f()); cleanup = []; closeSheet(); closePopover(); player.unload(); }

export async function renderReader(root, header, route) {
  leaveReader();
  const { book, chapter } = route;
  const info = await repo.bookInfo(book);
  if (!info || !info.imported || chapter < 1 || chapter > info.chapters) return go({ name: "book", book }, { replace: true });

  const [data, lexicon, zhMeta, enMeta, track] = await Promise.all([
    repo.chapter(book, chapter), repo.lexicon(book), repo.translationMeta("cuv"), repo.translationMeta("web"), trackFor(book, chapter)]);
  let bar = null, followEnglish = false, autoRevealed = null, lastUserScroll = 0, playingId = null;
  const revealed = new Set();          // row keys whose English is shown
  const openNotes = new Set();
  const rowByVerse = new Map();
  data.rows.forEach(r => { r.zh.forEach(v => rowByVerse.set(v.id, r)); r.en.forEach(v => rowByVerse.set(v.id, r)); });

  // ---------------- header
  const revealBtn = h("button.btn.reveal-all", { type: "button", onclick: toggleAll });
  const listenBtn = h("button.btn.listen-btn", { type: "button", onclick: () => (bar ? closeAudio() : track ? openAudio() : explainNoAudio()),
    class: track ? "" : "is-unavailable", title: track ? "Listen to this chapter in Mandarin" : "Audio for this chapter has not been generated yet",
    "aria-label": track ? "Listen" : "Listen (audio not yet available for this chapter)" }, icon("play"), h("span.listen-btn__label", "Listen"));
  async function explainNoAudio() {
    const ready = (await availableChapters()).filter(k => k.startsWith(book + ".")).map(k => k.split(".")[1]);
    toast(ready.length ? `Audio is ready for ${info.name.en} ${ready.join(", ")} so far — this chapter is coming next.` : "Audio for this book has not been generated yet.");
  }
  const titleBtn = h("button.reader__title-btn", { type: "button", onclick: () => openPicker(info, chapter), "aria-label": "Choose chapter" },
    h("span.zh", `${info.name.zh} ${chapter}`), h("span.en", `${info.name.en} ${chapter}`), h("span.caret"));
  header.replaceChildren(
    h("div.masthead__side", h("a.btn.btn--icon", { href: `#book-${book}`, "aria-label": "Chapters" }, icon("back")),
      h("a.btn.btn--icon", { href: "#home", "aria-label": "Library" }, icon("book"))),
    h("div.masthead__title", titleBtn),
    h("div.masthead__side.masthead__side--end", listenBtn, revealBtn,
      h("a.btn.btn--icon", { href: "#vocab", "aria-label": "Vocabulary" }, icon("notebook")),
      h("button.btn.btn--icon", { type: "button", onclick: openSettings, "aria-label": "Reading settings" }, icon("type"))));

  // ---------------- body
  const textWrap = h("div.text");
  const article = h("article.reader",
    h("header.chapter-head",
      h("div.chapter-head__book", info.name.zh),
      h("div.chapter-head__num", `第${zhNum(chapter)}章`),
      h("div.chapter-head__en", `${info.name.en} · Chapter ${chapter}`),
      h("hr.chapter-head__rule"),
      h("p.chapter-head__hint", "Tap a word for its meaning · tap a verse number for the English")),
    h("div.abar-slot"),
    textWrap,
    chapterEnd(info, chapter, zhMeta, enMeta));
  root.replaceChildren(article);

  function paint() {
    const p = store.get("prefs");
    article.className = ["reader", `py-${p.pinyin}`, p.redLetter ? "red-letter" : "", p.showNotes ? "" : "no-notes", p.showHeadings ? "" : "no-headings"].join(" ");
    const all = data.rows.every(r => !r.zh.length || revealed.has(r.key));
    revealBtn.replaceChildren(icon("translate"), h("span.reveal-all__label", all ? "Hide all English" : "Reveal all English"));
    revealBtn.setAttribute("aria-pressed", String(all));
    textWrap.replaceChildren(renderFlow());
    markSaved();
    paintHighlights(textWrap);
    markPlaying(false);
  }

  function renderFlow() {
    const flow = h("div.flow.zh-text");
    let para = null;
    for (const row of data.rows) {
      for (const hd of row.zh.flatMap(v => v.headings || [])) { flow.append(h("span.passage-ref", hd.text)); para = null; }
      const v = row.zh[0];
      if (!para || (v && v.para)) { para = h("p", { class: v && /^q/.test(v.para || "") ? "q" : "" }); flow.append(para); }
      if (!row.zh.length) {
        // a verse the CUV numbers differently (5:4, 7:53): labelled, never blank
        para.append(h("span.gap", { "data-gap": row.key },
          h("button.vnum", { type: "button", "data-row": row.key, "aria-label": `Verse ${row.key.split(".")[2]}` }, row.key.split(".")[2]),
          h("span.gap-note", h("span.zh", row.note.zh), " ", row.note.en)));
        if (revealed.has(row.key)) para.append(revealBlock(row));
        continue;
      }
      for (const zv of row.zh) {
        const el = zhVerse(zv, { bands: data.bands, onNote: toggleNotes });
        el.querySelectorAll(".w").forEach(w => w.classList.add("is-tappable"));
        el.querySelector(".vnum").dataset.row = row.key;
        para.append(el);
        if (openNotes.has(zv.id)) para.append(notesBlock(zv, "zh"));
      }
      if (revealed.has(row.key)) para.append(revealBlock(row));
    }
    return flow;
  }

  function revealBlock(row) {
    const ids = row.en.map(v => v.id.split(".").slice(1).join(":"));
    const [, c, n] = (row.zh[0] || row.en[0]).id.split(".");
    return h("span.reveal", { "data-reveal": row.key },
      h("span.ref", ids.join("–")),
      row.en.map(ev => [enInline(ev), " "]),
      row.note ? h("span.gap-note", row.note.en) : null,
      h("span.reveal__actions",
        row.zh.length ? verseHighlighter(row) : null,
        h("button.linkish", { type: "button", onclick: () => copyVerse(row, c, n) }, "Copy"),
        h("button.linkish", { type: "button", onclick: () => toggleRow(row.key) }, "Hide")));
  }
  // "Highlight" in a revealed verse: the colours appear only when asked for
  function verseHighlighter(row) {
    const ranges = () => row.zh.map(v => ({ verseId: v.id, start: 0, end: v.text.length, verseText: v.text }));
    const wrap = h("span.reveal__hl");
    const closed = () => wrap.replaceChildren(h("button.linkish", { type: "button", onclick: e => { e.stopPropagation(); opened(); } }, "Highlight"));
    const opened = () => {
      const has = row.zh.some(v => highlights.forVerse(v.id).length);
      wrap.replaceChildren(...highlights.COLORS.map(c => h("button.hl-swatch.hl-swatch--small", { type: "button", "data-color": c, "aria-label": `Highlight verse ${highlights.COLOR_NAMES[c].toLowerCase()}`,
        onclick: async e => { e.stopPropagation(); await highlights.paint(ranges(), c); } })),
        has ? h("button.linkish", { type: "button", onclick: async e => { e.stopPropagation(); await highlights.clear(ranges()); } }, "Remove") : null);
    };
    closed();
    return wrap;
  }
  function enInline(ev) {
    const el = enVerse(ev);
    el.classList.remove("verse"); el.removeAttribute("data-id");
    el.querySelector(".vnum")?.remove();
    el.querySelectorAll(".fn").forEach(f => f.remove());
    return el;
  }

  function toggleRow(key) { revealed.has(key) ? revealed.delete(key) : revealed.add(key); closePopover(); paint(); }
  function toggleAll() {
    const all = data.rows.every(r => !r.zh.length || revealed.has(r.key));
    if (all) revealed.clear(); else data.rows.forEach(r => revealed.add(r.key));
    keepPlace(() => paint());
  }
  function toggleNotes(v) { openNotes.has(v.id) ? openNotes.delete(v.id) : openNotes.add(v.id); paint(); }

  // tap a verse number, or the verse's punctuation (anything that is not a word)
  textWrap.addEventListener("click", e => {
    if (e.target.closest(".w, .fn, .reveal, .footnotes")) return;
    const sel = getSelection(); if (sel && !sel.isCollapsed && sel.toString().trim()) return;   // a text selection, not a tap
    const num = e.target.closest(".vnum");
    const verse = e.target.closest(".verse[data-id]");
    const key = num ? num.dataset.row : verse ? rowByVerse.get(verse.dataset.id)?.key : null;
    if (bar && num && num.dataset.verse) { player.playFrom(num.dataset.verse); return; }
    if (key) toggleRow(key);
  });

  // ---------------- words: dictionary popover
  const detach = attachWordPopover(textWrap, w => {
    const verseEl = w.closest(".verse[data-id]");
    const verseId = verseEl.dataset.id;
    const row = rowByVerse.get(verseId);
    const zv = row.zh.find(v => v.id === verseId);
    const tok = zv.tokens.filter(Array.isArray)[+w.dataset.t];
    const entry = lexicon.entries[`${tok[0]}|${tok[1]}`];
    const o = +w.dataset.o, n = +w.dataset.n;
    return {
      entry, bookZh: info.name.zh, bookEn: info.name.en,
      onSpeak: async () => { if (!(await playWord(info.code, `${tok[0]}|${tok[1]}`))) toast("Pronunciation not available for this word yet"); },
      highlight: () => {
        const cur = highlights.at(verseId, o);
        return {
          color: cur ? cur.color : null,
          apply: c => cur ? highlights.setColor(cur.id, c) : highlights.paint([{ verseId, start: o, end: o + n, verseText: zv.text }], c),
          remove: () => cur && highlights.remove(cur.id),
        };
      },
      verse: { id: verseId, zh: zv.text, en: row.en.map(v => v.text).join(" ") },
      onTranslate: () => { if (!revealed.has(row.key)) toggleRow(row.key); else closePopover(); },
      onPlay: track ? () => { closePopover(); if (!bar) openAudio({ from: verseId }); else player.playFrom(verseId); } : null,
    };
  });
  cleanup.push(detach);

  // ---------------- highlights: select text -> colour toolbar
  cleanup.push(attachHighlighter(textWrap, id => { const r = rowByVerse.get(id); const v = r && r.zh.find(x => x.id === id); return v ? v.text : null; }));
  cleanup.push(highlights.subscribe(() => { paintHighlights(textWrap); refreshPopover(); }));

  // saved words are tinted in the text (verse -> vocabulary direction)
  function markSaved() {
    const saved = new Set(vocab.all().map(r => r.id));
    for (const verseEl of $$(".verse[data-id]", textWrap)) {
      const row = rowByVerse.get(verseEl.dataset.id);
      const zv = row && row.zh.find(v => v.id === verseEl.dataset.id);
      if (!zv || !zv.tokens) continue;
      const toks = zv.tokens.filter(Array.isArray);
      verseEl.querySelectorAll(".w[data-t]").forEach(w => {
        const t = toks[+w.dataset.t];
        w.classList.toggle("is-saved", saved.has(`${t[0]}|${t[1]}`));
      });
    }
  }
  cleanup.push(vocab.subscribe(markSaved));

  async function copyVerse(row, c, n) {
    const zh = row.zh.map(v => v.text).join(""), en = row.en.map(v => v.text).join(" ");
    const text = `${zh}\n（${info.name.zh} ${c}:${n} 和合本）\n\n${en}\n(${info.name.en} ${c}:${n} WEB)`;
    try { await navigator.clipboard.writeText(text); toast("Verse copied"); } catch { toast("Copy is not available here"); }
  }

  // ---------------- listening
  function openAudio({ from } = {}) {
    if (!track || bar) return;
    player.load(track);
    bar = createAudioBar({
      bookZh: info.name.zh, bookEn: info.name.en,
      onClose: closeAudio,
      onFollowEnglish: on => {
        followEnglish = on;
        if (!on) { if (autoRevealed) { revealed.delete(autoRevealed); autoRevealed = null; keepPlace(paint); } return; }
        const row = playingId && rowByVerse.get(playingId);       // show the verse being read right away
        if (row && !revealed.has(row.key)) { revealed.add(row.key); autoRevealed = row.key; keepPlace(paint); }
        markPlaying(true);
      },
    });
    $(".abar-slot", article).replaceWith(h("div.abar-slot", bar.el));
    article.classList.add("is-listening");
    listenBtn.setAttribute("aria-pressed", "true");
    const start = from || topVisibleVerse() || track.segments[0].verseId;
    player.playFrom(track.segments.some(sg => sg.verseId === start) ? start : track.segments[0].verseId);
  }
  function closeAudio() {
    player.unload();
    if (bar) { bar.destroy(); bar = null; }
    article.classList.remove("is-listening");
    listenBtn.setAttribute("aria-pressed", "false");
    playingId = null;
    $$(".verse.is-playing", textWrap).forEach(e => e.classList.remove("is-playing"));
    if (autoRevealed) { revealed.delete(autoRevealed); autoRevealed = null; keepPlace(paint); }
  }
  function markPlaying(scroll) {
    $$(".verse.is-playing", textWrap).forEach(e => e.classList.remove("is-playing"));
    if (!playingId) return;
    const el = $(`.verse[data-id="${playingId}"]`, textWrap);
    if (!el) return;
    el.classList.add("is-playing");
    if (scroll && Date.now() - lastUserScroll > 2500) {
      const r = el.getBoundingClientRect();
      const top = (document.querySelector(".masthead")?.offsetHeight || 52) + 16;
      const barH = bar ? bar.el.getBoundingClientRect().height + 24 : 24;
      if (r.top < top || r.bottom > innerHeight - barH) scrollTo({ top: scrollY + r.top - top - 40, behavior: "smooth" });
    }
  }
  cleanup.push(player.subscribe(s => {
    if (!bar) return;
    const id = s.segment ? s.segment.verseId : null;
    if (id === playingId) return;
    playingId = id;
    if (followEnglish && id) {
      const row = rowByVerse.get(id);
      if (autoRevealed && autoRevealed !== row.key) revealed.delete(autoRevealed);
      if (!revealed.has(row.key)) { revealed.add(row.key); autoRevealed = row.key; }
      keepPlace(paint);
    }
    markPlaying(true);
  }));
  const noteScroll = () => { lastUserScroll = Date.now(); };
  addEventListener("wheel", noteScroll, { passive: true });
  addEventListener("touchmove", noteScroll, { passive: true });
  cleanup.push(() => { removeEventListener("wheel", noteScroll); removeEventListener("touchmove", noteScroll); if (bar) bar.destroy(); bar = null; });

  // ---------------- position tracking
  function topVisibleVerse() {
    const top = (document.querySelector(".masthead")?.offsetHeight || 52) + 8;
    for (const el of $$(".verse[data-id]", textWrap)) { if (el.getBoundingClientRect().bottom > top) return el.dataset.id; }
    return null;
  }
  function keepPlace(fn) {
    const id = topVisibleVerse();
    const el = id && $(`.verse[data-id="${id}"]`, textWrap);
    const before = el ? el.getBoundingClientRect().top : 0;
    fn();
    const after = id && $(`.verse[data-id="${id}"]`, textWrap);
    if (after) scrollBy(0, after.getBoundingClientRect().top - before);
  }
  const savePos = debounce(() => {
    const id = topVisibleVerse();
    if (id) { const [, c, v] = id.split("."); if (+c === chapter) store.setPosition(book, chapter, +v); }
    const end = $(".chapter-end", article);
    if (end && end.getBoundingClientRect().top < innerHeight) store.markChapterRead(book, chapter);
  }, 400);
  addEventListener("scroll", savePos, { passive: true });
  cleanup.push(() => removeEventListener("scroll", savePos));

  function scrollToVerse(id, { flash = true, word = null } = {}) {
    const el = $(`.verse[data-id="${id}"]`, textWrap);
    if (!el) return;
    const top = el.getBoundingClientRect().top + scrollY - (document.querySelector(".masthead")?.offsetHeight || 52) - 24;
    scrollTo({ top, behavior: "auto" });
    if (flash) { el.classList.remove("is-flash"); void el.offsetWidth; el.classList.add("is-flash"); }
    if (word) {
      const row = rowByVerse.get(id), zv = row.zh.find(v => v.id === id);
      const toks = zv.tokens.filter(Array.isArray);
      el.querySelectorAll(".w[data-t]").forEach(w => { const t = toks[+w.dataset.t]; if (`${t[0]}|${t[1]}` === word) w.classList.add("is-found"); });
    }
  }

  const onKey = e => {
    if (e.target.closest("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight" && chapter < info.chapters) go({ name: "read", book, chapter: chapter + 1 });
    if (e.key === "ArrowLeft" && chapter > 1) go({ name: "read", book, chapter: chapter - 1 });
  };
  addEventListener("keydown", onKey);
  cleanup.push(() => removeEventListener("keydown", onKey));

  cleanup.push(store.subscribe("prefs", p => { store.applyTypography(p); keepPlace(paint); }));
  paint();
  if (route.verse) {
    const id = `${book}.${chapter}.${route.verse}`;
    const word = sessionStorage.getItem("dujing:focusWord");
    sessionStorage.removeItem("dujing:focusWord");
    requestAnimationFrame(() => scrollToVerse(id, { word }));
    store.setPosition(book, chapter, route.verse);
  } else {
    scrollTo({ top: 0 });
    store.setPosition(book, chapter, 1);
  }
}

function chapterEnd(info, chapter, zhMeta, enMeta) {
  const prev = chapter > 1 ? chapter - 1 : null, next = chapter < info.chapters ? chapter + 1 : null;
  return h("footer.chapter-end",
    h("div.chapter-end__orn", "· · ·"),
    h("nav.chapter-nav", { "aria-label": "Chapter navigation" },
      prev ? h("a", { href: `#read-${info.code}-${prev}` }, h("small", "Previous"), h("b", h("span.zh", `第${zhNum(prev)}章`), `Chapter ${prev}`)) : h("span"),
      next ? h("a", { href: `#read-${info.code}-${next}` }, h("small", "Next"), h("b", h("span.zh", `第${zhNum(next)}章`), `Chapter ${next}`))
        : h("a", { href: `#book-${info.code}` }, h("small", "End of book"), h("b", "Back to chapters"))),
    h("p.attribution",
      h("span.zh", zhMeta.name.zh), ` (${zhMeta.abbreviation}), ${zhMeta.license.status}. `,
      `${enMeta.name.en} (${enMeta.abbreviation}), ${enMeta.license.status}. Texts from eBible.org, unaltered. Dictionary: CC-CEDICT (CC BY-SA 4.0). `,
      h("a", { href: "#about" }, "Sources")));
}

function openPicker(info, current) {
  const progress = store.get("progress");
  const read = progress.books[info.code]?.read || [];
  const grid = h("div.picker-grid");
  for (let c = 1; c <= info.chapters; c++) {
    grid.append(h("a", { href: `#read-${info.code}-${c}`, class: [c === current ? "is-current" : "", read.includes(c) ? "is-read" : ""].join(" "), onclick: () => closeSheet() }, String(c)));
  }
  const input = h("input", { placeholder: "3:16", inputmode: "decimal", "aria-label": "Go to chapter and verse" });
  const jump = h("form.picker-jump", { onsubmit: e => {
    e.preventDefault();
    const m = input.value.trim().match(/^(\d+)(?:[:：.\s](\d+))?$/);
    if (!m || +m[1] < 1 || +m[1] > info.chapters) return toast(`Chapters 1–${info.chapters}`);
    closeSheet(); go({ name: "read", book: info.code, chapter: +m[1], verse: m[2] ? +m[2] : null });
  } }, h("span.label", "Go to"), input, h("button.btn.btn--outline", { type: "submit" }, "Go"));
  openSheet({ title: `${info.name.zh} · ${info.name.en}`, body: h("div", grid, jump, h("p.faint", { style: { fontSize: "12px", marginTop: "14px" } }, h("a", { href: "#home", onclick: () => closeSheet() }, "Other books in the library"))) });
}

const ZH_DIGITS = "零一二三四五六七八九";
export function zhNum(n) {
  if (n < 10) return ZH_DIGITS[n];
  if (n < 20) return "十" + (n % 10 ? ZH_DIGITS[n % 10] : "");
  if (n < 100) return ZH_DIGITS[Math.floor(n / 10)] + "十" + (n % 10 ? ZH_DIGITS[n % 10] : "");
  const hc = Math.floor(n / 100), rest = n % 100;
  return ZH_DIGITS[hc] + "百" + (rest ? (rest < 10 ? "零" + ZH_DIGITS[rest] : (rest < 20 ? "一" : "") + zhNum(rest)) : "");
}
