// Vocabulary: categories (Study / Review / Strong / Weak / Not studied / All),
// each word's page with every verse it is linked to, spaced-repetition study
// sessions with progressive reveal, and the end-of-session summary.
import { h, $, $$, debounce, toast } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as vocab from "../data/vocab.js";
import * as srs from "../data/srs.js";
import * as repo from "../data/repo.js";
import { go } from "../core/router.js";
import { hexId, fromHexId } from "../components/wordPopover.js";
import { playWord } from "../audio/wordAudio.js";

const FILTER_KEY = "dujing:vocabFilter";
const getFilter = () => { try { return { q: "", sort: "recent", book: "all", tab: "all", ...JSON.parse(sessionStorage.getItem(FILTER_KEY) || "{}") }; } catch { return { q: "", sort: "recent", book: "all", tab: "all" }; } };
const setFilter = f => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { } };
const plainPy = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").toLowerCase();
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };
const TABS = ["study", "review", "strong", "weak", "notStudied", "all"];

export function speakBtn(r, { label = true } = {}) {
  const book = (r.refs && r.refs[0] && r.refs[0].book) || "JHN";
  return h("button.btn.speak", { type: "button", "aria-label": `Play pronunciation of ${r.word}`, title: "Hear this word",
    onclick: async e => { e.stopPropagation(); const ok = await playWord(book, r.id); if (!ok) toast("Pronunciation not available for this word yet"); } },
    speakerIcon(), label ? h("span.speak__label", "Listen") : null);
}
function speakerIcon() {
  const s = document.createElement("span"); s.style.display = "inline-flex";
  s.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  return s.firstChild;
}

export function filtered(list, f, now = Date.now()) {
  const q = f.q.trim().toLowerCase();
  let out = list.filter(r => {
    if (f.tab && f.tab !== "all" && !srs.categories(r, now).has(f.tab)) return false;
    if (f.book !== "all" && !r.refs.some(x => x.book === f.book)) return false;
    if (!q) return true;
    return r.word.includes(f.q.trim()) || plainPy(r.pinyin).includes(plainPy(q)) ||
      (r.definition || "").toLowerCase().includes(q) || (r.senses || []).some(s => s.toLowerCase().includes(q));
  });
  const due = r => (r.srs && r.srs.due) || "9999";
  if (f.sort === "recent") out.sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""));
  else if (f.sort === "oldest") out.sort((a, b) => (a.addedAt || "").localeCompare(b.addedAt || ""));
  else if (f.sort === "pinyin") out.sort((a, b) => plainPy(a.pinyin).localeCompare(plainPy(b.pinyin)));
  else if (f.sort === "verses") out.sort((a, b) => b.refs.length - a.refs.length);
  else if (f.sort === "due") out.sort((a, b) => due(a).localeCompare(due(b)));
  return out;
}

function statusLine(r) {
  const s = r.srs;
  if (!s || !s.reps) return h("span.vstatus.vstatus--new", "Not studied");
  const cats = srs.categories(r);
  return h("span.vstatus", { class: cats.has("review") ? "vstatus--review" : cats.has("strong") ? "vstatus--strong" : cats.has("weak") ? "vstatus--weak" : "" },
    cats.has("review") ? "On Review list · " : cats.has("strong") ? "Strong · " : cats.has("weak") ? "Weak · " : "",
    srs.describeNext(s));
}

// ---------------------------------------------------------------- list
export async function renderVocab(root) {
  const f = getFilter();
  const canon = await repo.canon();
  const list = h("div.vocab-list");
  const count = h("span.folio__meta");
  const undoBar = h("div.undo", { hidden: true });
  const tabs = h("nav.vtabs", { role: "tablist", "aria-label": "Flashcard categories" });
  let selecting = false;
  const selected = new Set();

  const search = h("input", { type: "search", value: f.q, placeholder: "Search 汉字, pinyin or English", "aria-label": "Search flashcards" });
  const sort = h("select", { "aria-label": "Sort" },
    [["recent", "Recently added"], ["oldest", "First added"], ["pinyin", "Pinyin A–Z"], ["due", "Next review"], ["verses", "Most verses"]].map(([v, t]) => h("option", { value: v, selected: f.sort === v }, t)));
  const books = h("select", { "aria-label": "Filter by book" });
  const studyBtn = h("a.btn.btn--primary.study-btn", { href: "#study-session" }, "Study");
  const selectBtn = h("button.btn.btn--small", { type: "button", onclick: () => { selecting = !selecting; selected.clear(); update(); } }, "Select");
  const bulkBar = h("div.bulkbar", { hidden: true });

  root.replaceChildren(h("main.page.vocab-page",
    h("div.folio", h("h1.folio__title", "Flashcards", h("span.zh", "生词卡")), count),
    h("div.study-hero", h("div.study-hero__text"), studyBtn),
    tabs,
    h("div.vocab-tools",
      h("label.vocab-search", icon("search"), search),
      h("div.vocab-selects", h("label", h("span.label", "Sort"), sort), h("label", h("span.label", "Book"), books)),
      selectBtn),
    bulkBar, undoBar, list));

  const update = () => {
    const all = vocab.all(), now = Date.now();
    const counts = Object.fromEntries(TABS.map(t => [t, all.filter(r => srs.categories(r, now).has(t)).length]));
    const sess = srs.buildSession(all, { now });
    const nDue = sess.cards.length - sess.newIds.length;
    $(".study-hero__text", root).replaceChildren(
      h("div.study-hero__big", all.length ? `${sess.cards.length} card${sess.cards.length === 1 ? "" : "s"} ready` : "No saved words yet"),
      h("div.study-hero__small", all.length ? `${nDue} due for review · ${sess.newIds.length} new · ${counts.notStudied} not yet studied` : "Tap a word while reading and choose Add to Flashcards."));
    studyBtn.classList.toggle("is-disabled", !sess.cards.length);
    tabs.replaceChildren(...TABS.map(t => h("button.vtab", { type: "button", role: "tab", "aria-selected": String(f.tab === t), "data-tab": t,
      onclick: () => { f.tab = t; setFilter(f); update(); } }, h("span", srs.LABEL[t]), h("span.zh", srs.LABEL_ZH[t]), h("b", String(counts[t])))));
    const present = [...new Set(all.flatMap(r => r.refs.map(x => x.book)))];
    books.replaceChildren(h("option", { value: "all" }, "All books"),
      ...present.map(code => { const b = canon.books.find(x => x.code === code); return h("option", { value: code, selected: f.book === code }, b ? `${b.name.zh} ${b.name.en}` : code); }));
    const rows = filtered(all, f, now);
    count.textContent = all.length ? `${all.length} word${all.length > 1 ? "s" : ""} · ${all.reduce((n, r) => n + r.refs.length, 0)} verse links` : "";
    selectBtn.textContent = selecting ? "Done" : "Select";
    bulkBar.hidden = !selecting;
    bulkBar.replaceChildren(
      h("span", `${selected.size} selected`),
      h("button.btn.btn--small", { type: "button", onclick: () => { rows.forEach(r => selected.add(r.id)); update(); } }, "Select all shown"),
      h("button.btn.btn--small", { type: "button", disabled: !selected.size, onclick: async () => { await vocab.resetProgress([...selected]); toast(`Progress reset for ${selected.size} word${selected.size > 1 ? "s" : ""}`); selected.clear(); update(); } }, "Reset progress"),
      h("button.btn.btn--small.danger", { type: "button", disabled: !selected.size, onclick: () => removeWords([...selected]) }, "Remove"));
    if (!all.length) {
      list.replaceChildren(h("div.vocab-empty",
        h("p.zh", "生词本还是空的。"),
        h("p", "You have no flashcards yet. While reading, tap any Chinese word and choose ", h("em", "Add to Flashcards"), ". It will appear here with the verse where you found it."),
        h("a.btn.btn--outline", { href: "#read-JHN-1" }, "Open John 1")));
      return;
    }
    if (!rows.length) { list.replaceChildren(h("p.faint", { style: { padding: "24px 0" } }, `No words in “${srs.LABEL[f.tab]}”${f.q ? " match" : ""}.`)); return; }
    list.replaceChildren(...rows.map(entryRow));
  };

  function entryRow(r) {
    const first = r.refs.find(x => x.verseId === r.firstRef) || r.refs[0];
    const box = selecting ? h("input.vsel", { type: "checkbox", checked: selected.has(r.id), "aria-label": `Select ${r.word}`,
      onchange: e => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); update(); } }) : null;
    return h("article.vocab-entry", { class: selecting ? "is-selecting" : "", "data-id": r.id },
      h("div.vocab-entry__head", box, h("a.vocab-entry__word.zh", { href: `#word-${hexId(r.id)}` }, r.word)),
      h("div.vocab-entry__body",
        h("div.vocab-entry__line", h("span.vocab-entry__py", r.pinyin), r.pos ? h("span.vocab-entry__pos", r.pos) : null, statusLine(r)),
        h("p.vocab-entry__def", r.definition),
        h("p.vocab-entry__refs",
          r.refs.map((x, i) => [i ? " · " : "", h("a", { href: `#read-${x.book}-${x.chapter}-${x.verse}`, onclick: () => sessionStorage.setItem("dujing:focusWord", r.id) }, `${x.bookZh} ${x.chapter}:${x.verse}`)])),
        first ? h("p.vocab-entry__verse.zh", highlight(first.zh, r.word)) : null),
      h("div.vocab-entry__actions",
        speakBtn(r, { label: false }),
        h("a.btn.btn--small", { href: `#word-${hexId(r.id)}` }, "Open"),
        h("button.btn.btn--small", { type: "button", onclick: () => removeWords([r.id]) }, "Remove")));
  }

  async function removeWords(ids) {
    const recs = await vocab.removeMany(ids);
    ids.forEach(id => selected.delete(id));
    undoBar.hidden = false;
    undoBar.replaceChildren(h("span", recs.length === 1 ? ["Removed ", h("span.zh", recs[0].word), "."] : `Removed ${recs.length} words.`),
      h("button.btn.btn--small", { type: "button", onclick: async () => { await vocab.restoreMany(recs); undoBar.hidden = true; } }, "Undo"));
    clearTimeout(undoBar._t); undoBar._t = setTimeout(() => { undoBar.hidden = true; }, 8000);
  }

  search.addEventListener("input", debounce(() => { f.q = search.value; setFilter(f); update(); }, 120));
  sort.addEventListener("change", () => { f.sort = sort.value; setFilter(f); update(); });
  books.addEventListener("change", () => { f.book = books.value; setFilter(f); update(); });
  const unsub = vocab.subscribe(update);
  window.addEventListener("hashchange", unsub, { once: true });
  update();
}

function highlight(text, word) {
  const out = []; let i = 0, j;
  while ((j = text.indexOf(word, i)) >= 0) { out.push(text.slice(i, j), h("mark", word)); i = j + word.length; }
  out.push(text.slice(i));
  return out;
}

// ---------------------------------------------------------------- one word
export async function renderWord(root, hex) {
  const id = fromHexId(hex);
  const r = vocab.get(id);
  if (!r) {
    root.replaceChildren(h("main.page", h("p.notice", "This word is not in your flashcards (it may have been removed). ", h("a", { href: "#vocab" }, "Back to Flashcards"), ".")));
    return;
  }
  let entry = null;
  try { const lex = await repo.lexicon(r.refs[0].book); entry = lex.entries[id] || null; } catch { }
  const senses = (entry && entry.senses) || r.senses || [];
  const s = r.srs;
  const RES = { got: "Got it", almost: "Almost", forgot: "Forgot" };

  const verses = h("ol.word-verses", r.refs.map(x => h("li.word-verse",
    h("a.word-verse__ref", { href: `#read-${x.book}-${x.chapter}-${x.verse}`, onclick: () => sessionStorage.setItem("dujing:focusWord", r.id) },
      h("span.zh", `${x.bookZh} ${x.chapter}:${x.verse}`), ` ${x.bookEn} ${x.chapter}:${x.verse}`, x.verseId === r.firstRef ? h("span.word-verse__first", "first met here") : null),
    h("p.word-verse__zh.zh", highlight(x.zh, r.word)),
    h("p.word-verse__en", x.en),
    x.contextual ? h("p.word-verse__ctx", h("span.label", "In this verse "), x.contextual) : null,
    h("div.word-verse__meta", h("span", `Added ${fmtDate(x.addedAt)}`),
      r.refs.length > 1 ? h("button.linkish", { type: "button", onclick: async () => { await vocab.detachRef(r.id, x.verseId); renderWord(root, hex); } }, "Detach this verse") : null))));

  root.replaceChildren(h("main.page.word-page",
    h("div.folio", h("a.folio__meta", { href: "#vocab" }, "← Flashcards"), h("span.folio__meta", `Saved ${fmtDate(r.addedAt)}`)),
    h("header.word-head",
      h("div.word-head__word.zh", r.word),
      h("div.word-head__py", r.pinyin, r.trad && r.trad !== r.word ? h("span.zh.faint", `  ${r.trad}`) : null),
      r.pos ? h("div.word-head__pos", r.pos) : null,
      h("div.word-head__actions", speakBtn(r))),
    senses.length ? h("ol.word-senses", senses.map(x => h("li", x))) : h("p.word-def", r.definition),
    entry && entry.note ? h("p.word-note", h("span.label", "Study note "), entry.note.text) : null,
    h("section.word-section.word-progress",
      h("h2.section__title", "Review progress", h("span.zh", "复习记录")),
      h("p", statusLine(r), s && s.reps ? ` · ${s.reps} review${s.reps > 1 ? "s" : ""}, forgotten ${s.lapses}×` : ""),
      s && s.history && s.history.length ? h("ol.word-history", s.history.slice().reverse().slice(0, 12).map(x =>
        h("li", h("span", fmtDate(x.at)), h("b", { class: `res--${x.result}` }, RES[x.result])))) : null),
    h("section.word-section",
      h("h2.section__title", `Found in ${r.refs.length} verse${r.refs.length > 1 ? "s" : ""}`, h("span.zh", "经文出处")),
      verses),
    h("div.word-actions",
      h("a.btn.btn--outline", { href: "#study-session", onclick: () => sessionStorage.setItem("dujing:studyOnly", r.id) }, "Study this word now"),
      h("button.btn", { type: "button", onclick: async () => { await vocab.removeMany([r.id]); go({ name: "vocab" }); } }, "Remove from flashcards")),
    h("p.word-src", (entry && entry.kind === "dictionary") ? "Definitions: CC-CEDICT (CC BY-SA 4.0)." : "")));
  scrollTo(0, 0);
}

// ---------------------------------------------------------------- study session
export async function renderStudy(root) {
  const only = sessionStorage.getItem("dujing:studyOnly");
  sessionStorage.removeItem("dujing:studyOnly");
  const all = vocab.all();
  const plan = only && vocab.get(only) ? { cards: [only], newIds: vocab.get(only).srs && vocab.get(only).srs.reps ? [] : [only] } : srs.buildSession(all);
  if (!plan.cards.length) {
    root.replaceChildren(h("main.page.cards-page", h("div.folio", h("h1.folio__title", "Study", h("span.zh", "复习")), h("a.folio__meta", { href: "#vocab" }, "← Flashcards")),
      h("p.notice", all.length ? "Nothing is due right now — every word is scheduled for later. Come back tomorrow, or add new words while reading." : "No saved words yet. Tap a word while reading and choose “Add to Flashcards”.")));
    return;
  }
  const queue = [...plan.cards];
  const results = new Map();          // id -> first answer this session
  const requeued = new Set();
  let current = null;

  const progress = h("div.sess-progress", h("i"));
  const counter = h("span.sess-count");
  const stage = h("div.card-stage");
  const grades = [
    h("button.ans.ans--forgot", { type: "button", onclick: () => respond("forgot"), title: "1 · or swipe left" }, h("b", "Forgot"), h("span.zh", "忘了")),
    h("button.ans.ans--almost", { type: "button", onclick: () => respond("almost"), title: "2" }, h("b", "Almost"), h("span.zh", "差不多")),
    h("button.ans.ans--got", { type: "button", onclick: () => respond("got"), title: "3 · or swipe right" }, h("b", "Got it!"), h("span.zh", "记得"))];
  const flipBtn = h("button.ans.ans--flip", { type: "button", onclick: () => flip(), title: "Space" }, h("b", "Flip card"), h("span.zh", "翻卡"));
  const answers = h("div.answer-bar");
  let flipped = false;
  root.replaceChildren(h("main.page.cards-page.study-page",
    h("div.folio", h("h1.folio__title", "Study", h("span.zh", "复习")), h("a.folio__meta", { href: "#vocab" }, "End session")),
    h("div.sess-top", counter, progress),
    stage, answers,
    h("p.card-hint.faint", "Tap the card (or Space) to flip it · then 1 Forgot · 2 Almost · 3 Got it · on a phone, swipe left or right")));

  function show() {
    const id = queue[0];
    current = vocab.get(id);
    if (!current) { queue.shift(); return queue.length ? show() : finish(); }
    flipped = false;
    paintAnswers();
    const done = plan.cards.length - queue.filter(x => plan.cards.includes(x) && !results.has(x)).length;
    counter.textContent = `${Math.min(done + 1, plan.cards.length)} / ${plan.cards.length}${requeued.size ? ` · ${[...requeued].filter(x => queue.includes(x)).length} to repeat` : ""}`;
    $("i", progress).style.width = `${(results.size / plan.cards.length) * 100}%`;
    stage.replaceChildren(card(current));
  }

  // A two-sided flashcard: the word on the front; pinyin, meaning and the verse on the back.
  function card(r) {
    const ref = r.refs.find(x => x.verseId === r.firstRef) || r.refs[0];
    const isNew = plan.newIds.includes(r.id) && !results.has(r.id);
    const front = h("div.scard__face.scard__front", { "aria-hidden": "false" },
      isNew ? h("span.scard__badge", "New") : null,
      h("div.scard__word.zh", r.word),
      h("div.scard__tap", "Tap to flip"));
    const back = h("div.scard__face.scard__back", { "aria-hidden": "true" },
      h("div.scard__head",
        h("div.scard__word.scard__word--small.zh", r.word),
        h("div.scard__py", r.pinyin, " ", speakBtn(r, { label: false }))),
      h("div.scard__meaning",
        r.pos ? h("div.scard__pos", r.pos) : null,
        h("p.scard__def", r.definition),
        ref && ref.contextual ? h("p.scard__ctx", h("span.label", `In ${ref.bookZh} ${ref.chapter}:${ref.verse} `), ref.contextual) : null),
      ref ? h("div.scard__verse",
        h("p.zh", highlight(ref.zh, r.word)),
        h("p.scard__en", ref.en),
        h("div.scard__links",
          h("a.scard__ref", { href: `#read-${ref.book}-${ref.chapter}-${ref.verse}`, onclick: () => sessionStorage.setItem("dujing:focusWord", r.id) }, `${ref.bookZh} ${ref.chapter}:${ref.verse} · ${ref.bookEn} ${ref.chapter}:${ref.verse}`),
          h("a.linkish", { href: `#word-${hexId(r.id)}` }, "Dictionary entry")),
        r.refs.length > 1 ? h("p.faint", { style: { fontSize: "12px", marginTop: "4px" } }, `+ ${r.refs.length - 1} more verse${r.refs.length > 2 ? "s" : ""}`) : null) : null);
    const el = h("div.scard", { tabindex: "0", role: "button", "aria-label": `Flashcard ${r.word}. Press to flip.`, "aria-pressed": "false" },
      h("div.scard__inner", front, back));
    el.addEventListener("click", e => { if (e.target.closest("a, button")) return; flip(); });
    attachSwipe(el);
    return el;
  }

  function flip() {
    if (!current) return;
    flipped = !flipped;
    const el = $(".scard", stage);
    el.classList.toggle("is-flipped", flipped);
    el.setAttribute("aria-pressed", String(flipped));
    $(".scard__front", el).setAttribute("aria-hidden", String(flipped));
    $(".scard__back", el).setAttribute("aria-hidden", String(!flipped));
    paintAnswers();
  }

  // before the flip: one Flip button; after: Forgot / Almost / Got it
  function paintAnswers() {
    answers.classList.toggle("is-front", !flipped);
    answers.replaceChildren(...(flipped ? grades : [flipBtn]));
  }

  async function respond(result) {
    if (!current) return;
    const id = current.id;
    await vocab.recordAnswer(id, result);
    if (!results.has(id)) results.set(id, result);
    queue.shift();
    if (result === "forgot" && !requeued.has(id)) { requeued.add(id); queue.push(id); }   // see it again before the session ends
    const el = $(".scard", stage);
    if (el) { el.classList.add(result === "got" ? "fly-right" : result === "forgot" ? "fly-left" : "fly-down"); await new Promise(r => setTimeout(r, 180)); }
    queue.length ? show() : finish();
  }

  function attachSwipe(el) {
    let x0 = null, dx = 0, pid = null;
    el.addEventListener("pointerdown", e => { if (!flipped || e.pointerType === "mouse" || e.target.closest("a, button")) return; x0 = e.clientX; dx = 0; pid = e.pointerId; });
    el.addEventListener("pointermove", e => {
      if (x0 == null || e.pointerId !== pid) return;
      dx = e.clientX - x0;
      if (Math.abs(dx) > 8) { el.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`; el.dataset.swipe = dx > 0 ? "got" : "forgot"; el.style.setProperty("--swipe", Math.min(1, Math.abs(dx) / 110)); }
    });
    const end = () => {
      if (x0 == null) return;
      const d = dx; x0 = null; el.style.transform = ""; delete el.dataset.swipe;
      if (d > 90) respond("got"); else if (d < -90) respond("forgot");
    };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  }

  function finish() {
    current = null;
    const by = k => [...results].filter(([, v]) => v === k).map(([id]) => id);
    sessionStorage.setItem("dujing:lastSession", JSON.stringify({ at: new Date().toISOString(), newIds: plan.newIds, got: by("got"), almost: by("almost"), forgot: by("forgot") }));
    removeEventListener("keydown", onKey);
    location.hash = "study-summary";
  }

  const onKey = e => {
    if (e.target.closest("input, textarea, select") || !current) return;
    if (e.key === " " || e.key === "Enter") { if (e.target.closest("a, button:not(.scard)")) return; e.preventDefault(); flip(); }
    if (!flipped) return;
    if (e.key === "1") respond("forgot");
    if (e.key === "2") respond("almost");
    if (e.key === "3") respond("got");
  };
  addEventListener("keydown", onKey);
  window.addEventListener("hashchange", () => removeEventListener("keydown", onKey), { once: true });
  show();
}

// ---------------------------------------------------------------- summary
export function renderSummary(root, initial = "all-session") {
  let last; try { last = JSON.parse(sessionStorage.getItem("dujing:lastSession") || "null"); } catch { last = null; }
  const all = vocab.all();
  const notStudied = all.filter(r => !r.srs || !r.srs.reps).map(r => r.id);
  const CATS = [
    ["new", "New words", "新词", last ? last.newIds : []],
    ["got", "Remembered", "记得", last ? last.got : []],
    ["almost", "Partly recalled", "差不多", last ? last.almost : []],
    ["forgot", "Forgotten", "忘了", last ? last.forgot : []],
    ["notStudied", "Not studied", "未学习", notStudied],
    ["all", "All saved words", "全部", all.map(r => r.id)],
  ];
  let active = "got";
  const list = h("div.sum-list");
  const chips = h("div.sum-chips");
  const paint = () => {
    chips.replaceChildren(...CATS.map(([k, en, zh, ids]) => h("button.sum-chip", { type: "button", "aria-pressed": String(active === k), "data-cat": k, onclick: () => { active = k; paint(); } },
      h("b", String(ids.length)), h("span", en), h("span.zh", zh))));
    const ids = CATS.find(c => c[0] === active)[3];
    const recs = ids.map(id => vocab.get(id)).filter(Boolean);
    list.replaceChildren(...(recs.length ? recs.map(r => h("a.sum-row", { href: `#word-${hexId(r.id)}` },
      h("span.sum-row__word.zh", r.word), h("span.sum-row__py", r.pinyin), h("span.sum-row__def", r.definition), statusLine(r)))
      : [h("p.faint", { style: { padding: "16px 0" } }, "No words in this group.")]));
  };
  paint();
  const reviewed = last ? last.got.length + last.almost.length + last.forgot.length : 0;
  const again = srs.buildSession(all).cards.length;
  root.replaceChildren(h("main.page.summary-page",
    h("div.folio", h("h1.folio__title", "Session complete", h("span.zh", "复习完成")), h("a.folio__meta", { href: "#vocab" }, "← Flashcards")),
    h("p.sum-lede", last ? `You reviewed ${reviewed} word${reviewed === 1 ? "" : "s"}${last.newIds.length ? `, ${last.newIds.length} of them new` : ""}. Forgotten words are on your Review list and will come back soon.` : "No session yet."),
    chips, list,
    h("div.word-actions",
      again ? h("a.btn.btn--primary", { href: "#study-session" }, `Study ${again} more`) : null,
      h("a.btn.btn--outline", { href: "#vocab" }, "Back to Flashcards"),
      h("a.btn", { href: "#read-JHN-1" }, "Keep reading"))));
  scrollTo(0, 0);
}
