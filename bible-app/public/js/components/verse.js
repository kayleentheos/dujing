// Rendering of single verses (Chinese with word tokens + ruby pinyin, English
// with words-of-Jesus styling) and their translators' notes.
import { h } from "../core/dom.js";

const HAN = /[㐀-鿿豈-﫿]/;
const styleClasses = st => (st || "").split("+").filter(Boolean).join(" ");

/** Chinese verse as <span class="verse"> with tokens. */
export function zhVerse(v, { bands = {}, onNote } = {}) {
  const el = h("span.verse", { "data-id": v.id, lang: "zh-Hans" });
  el.append(vnum(v));
  const notes = (v.notes || []).filter(n => n.type === "footnote").slice().sort((a, b) => a.at - b.at);
  let pos = 0, ni = 0, ti = 0;
  const pushNotesUpTo = p => {
    while (ni < notes.length && notes[ni].at <= p) { el.append(noteMark(v, ni, notes[ni], onNote)); ni++; }
  };
  if (v.tokens) {
    for (const t of v.tokens) {
      if (!Array.isArray(t)) { el.append(h("br.poetry-break")); continue; }
      const [text, py, st] = t;
      el.append(token(text, py, st, bands[text], ti++, pos));
      pos += text.length;
      pushNotesUpTo(pos);
    }
  } else {
    for (const r of v.runs) {
      if (!Array.isArray(r)) { el.append(h("br.poetry-break")); continue; }
      el.append(h("span", { class: styleClasses(r[1]) }, r[0]));
      pos += r[0].length; pushNotesUpTo(pos);
    }
  }
  pushNotesUpTo(Infinity);
  return el;
}

function token(text, py, st, band, i, at) {
  const han = HAN.test(text);
  const cls = ["w", styleClasses(st)];
  // data-o / data-n: character offset and length in the verse text (used by highlights)
  if (!han) return h("span.p", { class: styleClasses(st) || null, "data-o": at, "data-n": text.length }, text);
  if (band >= 3) cls.push("is-hard");
  const el = h("span", { class: cls.join(" "), "data-t": i, "data-o": at, "data-n": text.length });
  const syl = (py || "").split(" ").filter(Boolean);
  const chars = [...text];
  if (syl.length === chars.length) {
    // one syllable over each character
    const ruby = h("ruby");
    chars.forEach((c, k) => ruby.append(c, h("rt", syl[k])));
    el.append(ruby);
  } else if (syl.length) {
    el.append(h("ruby", text, h("rt", syl.join(""))));
  } else el.append(text);
  return el;
}

/** English verse */
export function enVerse(v, { onNote } = {}) {
  const el = h("span.verse", { "data-id": v.id, lang: "en" });
  el.append(vnum(v));
  const notes = (v.notes || []).slice().sort((a, b) => a.at - b.at);
  let pos = 0, ni = 0;
  for (const r of v.runs) {
    if (!Array.isArray(r)) { el.append(h("br.poetry-break")); continue; }
    const [text, st] = r;
    // split a run where a note falls inside it
    let local = 0;
    while (ni < notes.length && notes[ni].at <= pos + text.length) {
      const cut = notes[ni].at - pos;
      if (cut > local) el.append(h("span", { class: styleClasses(st) || null }, text.slice(local, cut)));
      el.append(noteMark(v, ni, notes[ni], onNote));
      local = Math.max(local, cut); ni++;
    }
    if (local < text.length) el.append(h("span", { class: styleClasses(st) || null }, text.slice(local)));
    pos += text.length;
  }
  while (ni < notes.length) { el.append(noteMark(v, ni, notes[ni], onNote)); ni++; }
  return el;
}

function vnum(v) {
  const [, c, n] = v.id.split(".");
  return h("button.vnum", { type: "button", "data-verse": v.id, "aria-label": `Verse ${n}` }, n);
}

function noteMark(v, i, n, onNote) {
  const sym = n.type === "crossref" ? "†" : "*";
  return h("button.fn", { type: "button", "data-note": `${v.id}:${i}`, title: n.type === "crossref" ? "Cross-reference" : "Translator’s note",
    onclick: e => { e.stopPropagation(); onNote && onNote(v, e.currentTarget); } }, sym);
}

/** Block listing a verse's notes, shown under the verse when a marker is tapped. */
export function notesBlock(v, lang) {
  const items = (v.notes || []);
  return h("span.footnotes", { "data-notes-for": v.id },
    items.map(n => h("span", { style: { display: "block" } },
      h("b", n.type === "crossref" ? "†" : "*"),
      h("span", { class: lang === "zh" ? "zh" : "" }, n.text))));
}
