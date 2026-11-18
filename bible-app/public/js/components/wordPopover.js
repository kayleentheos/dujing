// The dictionary popover for a single Chinese word.
//  Opens only on a deliberate click / tap — hovering never shows anything.
//  Click or tap another word to switch; click/tap outside or press Escape to close.
import { h, toast } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as vocab from "../data/vocab.js";
import { COLORS, COLOR_NAMES } from "../data/highlights.js";

let pop = null, anchor = null, pinned = false, ctx = null;

/**
 * Attach word interactions to a container of rendered verses.
 * getContext(tokenEl) -> { entry, verse:{id, zh, en, ref...}, bookZh, bookEn, onTranslate }
 */
export function attachWordPopover(container, getContext) {
  const click = e => {
    const w = e.target.closest(".w.is-tappable"); if (!w) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;     // finishing a text selection, not a tap
    e.stopPropagation();
    if (pinned && anchor === w) { close(); return; }
    open(w, getContext(w), true);
  };
  container.addEventListener("click", click);
  const outside = e => { if (pop && pinned && !pop.contains(e.target) && !e.target.closest(".w.is-tappable")) close(); };
  const key = e => { if (e.key === "Escape") close(); };
  const reflow = () => { if (pop && anchor) place(); };
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", key);
  addEventListener("resize", reflow);
  return () => {
    container.removeEventListener("click", click);
    document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); removeEventListener("resize", reflow);
    close();
  };
}

/** Re-render the open popover (after its word was highlighted, saved, …). */
export function refresh() { if (pop && ctx) { render(); place(); } }

export function close() {
  if (anchor) anchor.classList.remove("is-active");
  if (pop) pop.remove();
  pop = anchor = ctx = null; pinned = false;
}

function open(w, c, pin) {
  if (!c || !c.entry) return;
  if (anchor && anchor !== w) anchor.classList.remove("is-active");
  anchor = w; ctx = c; pinned = pin || pinned && anchor === w;
  w.classList.add("is-active");
  if (!pop) {
    pop = h("div.wordpop", { role: "dialog", "aria-label": "Dictionary" });
    document.body.append(pop);
  }
  pop.classList.toggle("is-pinned", pinned);
  render();
  place();
}

function render() {
  const { entry: e, verse, bookZh, bookEn, onTranslate, onPlay, onSpeak, highlight } = ctx;
  const rec = vocab.get(vocab.idFor(e.w, e.py));
  const matched = matchSenses(e.senses || [], verse.en);
  const verseNote = e.note && e.note.verses && e.note.verses[verse.id];
  const [, c, v] = verse.id.split(".");
  const refLabel = `${bookZh} ${c}:${v}`;

  // ----- save / attach button
  let action;
  if (!rec) action = h("button.btn.wordpop__save", { type: "button", onclick: doSave }, icon("bookmark"), "Add to Flashcards");
  else if (!vocab.hasRef(rec, verse.id)) action = h("button.btn.wordpop__save", { type: "button", onclick: doSave }, icon("bookmark"), `Add ${c}:${v} to this word`);
  else action = h("a.btn.wordpop__save.is-saved", { href: `#word-${hexId(rec.id)}` }, "✓ In your flashcards");

  const savedLine = rec ? h("p.wordpop__saved", `Saved · ${rec.refs.length} verse${rec.refs.length > 1 ? "s" : ""}: `,
    rec.refs.map((r, i) => [i ? ", " : "", h("a", { href: `#read-${r.book}-${r.chapter}-${r.verse}` }, `${r.chapter}:${r.verse}`)])) : null;

  // ----- meaning
  let meaning;
  if (e.kind === "dictionary") {
    meaning = h("ol.wordpop__senses", e.senses.slice(0, 5).map((s, i) => h("li", { class: matched.has(i) ? "is-match" : "" }, s)));
  } else if (e.kind === "parts") {
    meaning = h("div.wordpop__parts",
      h("p.wordpop__caveat", "Not a single entry in CC-CEDICT. Its parts:"),
      e.parts.map(p => h("p", h("span.zh", p.w), " ", h("span.py", p.py), " ", p.senses && p.senses.length ? p.senses.slice(0, 2).join("; ") : h("span.faint", "no entry"))));
  } else if (e.kind === "name") {
    meaning = h("p.wordpop__caveat", "Proper name in the CUV (a transliteration). Not listed in CC-CEDICT.");
  } else if (e.kind === "transliteration") {
    meaning = h("p.wordpop__caveat", "A transliteration not listed in CC-CEDICT — see the study note below.");
  } else {
    meaning = h("div", h("p.wordpop__caveat", "CC-CEDICT lists this word only with a different reading:"),
      (e.alt || []).map(a => h("p", h("span.py", a.py), " ", a.senses.slice(0, 2).join("; "))));
  }

  // ----- context in this verse
  const contextBits = [];
  if (verseNote) contextBits.push(h("p", verseNote));
  else if (matched.size && e.kind === "dictionary") {
    const words = [...matched].map(i => e.senses[i]).slice(0, 2);
    contextBits.push(h("p", "The English of this verse (WEB) matches: ", h("em", words.join("; ")), "."));
  }
  if (e.note && !verseNote) contextBits.push(h("p.wordpop__note", h("span.label", "Study note "), e.note.text));
  else if (e.note && verseNote) contextBits.push(h("p.wordpop__note", h("span.label", "Study note "), e.note.text));
  if (!contextBits.length) contextBits.push(h("p.faint", "No contextual note for this verse yet."));

  pop.replaceChildren(...[
    h("div.wordpop__head",
      h("div",
        h("div.wordpop__word.zh", e.w),
        h("div.wordpop__py", e.py, onSpeak ? h("button.wordpop__speak", { type: "button", "aria-label": `Hear ${e.w}`, title: "Hear this word", onclick: ev => { ev.stopPropagation(); onSpeak(); } }, speaker()) : null, e.pyChecked ? null : h("span.wordpop__flag", { title: "Pinyin from standard character readings; not confirmed by the dictionary" }, " · character readings"))),
      h("div.wordpop__pos", e.pos || h("span.faint", "part of speech unavailable"))),
    savedLine,
    h("div.wordpop__body", meaning, e.cl ? h("p.wordpop__cl", "Measure word: ", e.cl.join(", ")) : null),
    h("div.wordpop__ctx", h("div.label", `In ${refLabel}`), contextBits),
    h("div.wordpop__foot",
      action,
      h("div.wordpop__more",
        onPlay ? h("button.btn.wordpop__translate", { type: "button", onclick: () => onPlay() }, icon("play"), "Play verse") : null,
        h("button.btn.wordpop__translate", { type: "button", onclick: () => { onTranslate && onTranslate(); } }, icon("translate"), "Translate verse"))),
    highlight ? hlRow(highlight()) : null,
    h("p.wordpop__src", e.kind === "dictionary" ? "CC-CEDICT" : "", e.note ? (e.kind === "dictionary" ? " · " : "") + "study note: editorial" : "")].filter(Boolean));
}

function hlRow(hl) {
  return h("div.wordpop__hl", h("span.label", hl.color ? "Highlighted" : "Highlight"),
    h("div.hl-swatches", COLORS.map(c => h("button.hl-swatch", { type: "button", "data-color": c, "aria-label": `${COLOR_NAMES[c]} highlight`, "aria-pressed": String(hl.color === c),
      onclick: async ev => { ev.stopPropagation(); await hl.apply(c); refresh(); } }))),
    hl.color ? h("button.linkish.hl-remove", { type: "button", onclick: async ev => { ev.stopPropagation(); await hl.remove(); refresh(); } }, "Remove") : null);
}
function speaker() {
  const s = document.createElement("span");
  s.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  return s.firstChild;
}

async function doSave() {
  const { entry, verse, bookZh, bookEn } = ctx;
  const [book, chapter, v] = verse.id.split(".");
  const contextual = (entry.note && entry.note.verses && entry.note.verses[verse.id]) ||
    ([...matchSenses(entry.senses || [], verse.en)].map(i => entry.senses[i])[0]) || null;
  const res = await vocab.save({
    entry,
    ref: { verseId: verse.id, book, bookZh, bookEn, chapter: +chapter, verse: +v, zh: verse.zh, en: verse.en, contextual },
  });
  toast(res.status === "created" ? `Saved ${entry.w} to your flashcards` : res.status === "attached" ? `Added ${chapter}:${v} to ${entry.w}` : `${entry.w} is already saved`);
  pinned = true;
  if (pop) { pop.classList.add("is-pinned"); render(); place(); }
}

function place() {
  if (!pop || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const width = Math.min(340, vw - 16);
  pop.style.width = width + "px";
  let left = r.left + r.width / 2 - width / 2;
  left = Math.max(8, Math.min(left, vw - width - 8));
  pop.style.left = left + scrollX + "px";
  const ph = pop.offsetHeight;
  const below = r.bottom + 8, above = r.top - ph - 8;
  const top = (vh - below >= ph || above < 56) ? below : above;
  pop.style.top = top + scrollY + "px";
  pop.classList.toggle("is-above", top === above);
}

// ---- context matching: which dictionary senses appear in the English verse
const STOP = new Set("a an the of to in on at by for and or as is be (bound form) form bound one some something someone sb sth used etc with from into that this it its his her their our your my".split(" "));
const stem = w => w.toLowerCase().replace(/[^a-z]/g, "").replace(/(ing|ed|es|s)$/, "");
export function matchSenses(senses, en) {
  const words = new Set((en || "").toLowerCase().split(/[^a-z’']+/).map(stem).filter(Boolean));
  const hit = new Set();
  senses.forEach((s, i) => {
    const core = s.replace(/\([^)]*\)/g, " ").split(/[;,/]/).map(x => x.trim()).filter(Boolean);
    for (const phrase of core) {
      const ws = phrase.split(/\s+/).map(stem).filter(x => x && !STOP.has(x) && x.length > 2);
      if (ws.length && ws.every(x => words.has(x))) { hit.add(i); break; }
    }
  });
  return hit;
}

export const hexId = id => [...id.split("|")[0]].map(c => c.codePointAt(0).toString(16)).join("-") + "--" +
  [...(id.split("|")[1] || "")].map(c => c.codePointAt(0).toString(16)).join("-");
export const fromHexId = s => {
  const [a, b] = s.split("--");
  const dec = x => (x ? x.split("-").map(hx => String.fromCodePoint(parseInt(hx, 16))).join("") : "");
  return `${dec(a)}|${dec(b)}`;
};
