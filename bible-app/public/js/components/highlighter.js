// Highlighting by text selection. When the reader selects Chinese text (mouse
// drag on desktop, long-press + handles on a phone) a small toolbar appears by
// the selection with the six colours, and Remove when it overlaps an existing
// highlight. Selections snap to whole words, and may cross verses.
import { h, toast } from "../core/dom.js";
import * as hl from "../data/highlights.js";

const coarse = () => matchMedia("(pointer: coarse)").matches;

/**
 * container: element holding the rendered .verse[data-id] spans
 * verseText(verseId) -> the CUV text of that verse
 */
export function attachHighlighter(container, verseText) {
  let bar = null, ranges = [];

  function rangesFromSelection() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return [];
    const per = new Map();
    for (const tok of container.querySelectorAll(".verse[data-id] [data-o]")) {
      if (!range.intersectsNode(tok)) continue;
      // a selection that only touches the very edge of a token (offset 0 of the
      // next one, or the end of the previous one) should not grab it
      if (edgeOnly(range, tok)) continue;
      const v = tok.closest(".verse[data-id]").dataset.id;
      const o = +tok.dataset.o, n = +tok.dataset.n;
      const cur = per.get(v) || { verseId: v, start: o, end: o + n };
      cur.start = Math.min(cur.start, o); cur.end = Math.max(cur.end, o + n);
      per.set(v, cur);
    }
    const out = [];
    for (const r of per.values()) {
      const text = verseText(r.verseId); if (!text) continue;
      // don't start or end a highlight on punctuation / spaces
      while (r.start < r.end && /[\s　，。；：、！？「」『』（）]/.test(text[r.start])) r.start++;
      while (r.end > r.start && /[\s　，；：、「」『』（]/.test(text[r.end - 1])) r.end--;
      if (r.end > r.start) out.push({ ...r, verseText: text });
    }
    return out;
  }

  function show() {
    ranges = rangesFromSelection();
    if (!ranges.length) { hide(); return; }
    const overlaps = ranges.some(r => hl.forVerse(r.verseId).some(x => x.start < r.end && x.end > r.start));
    if (!bar) {
      bar = h("div.hltool", { role: "toolbar", "aria-label": "Highlight" });
      // keep the selection alive while the toolbar is pressed
      bar.addEventListener("pointerdown", e => e.preventDefault());
      bar.addEventListener("mousedown", e => e.preventDefault());
      document.body.append(bar);
    }
    bar.replaceChildren(
      ...hl.COLORS.map(c => h("button.hl-swatch", { type: "button", "data-color": c, "aria-label": `Highlight ${hl.COLOR_NAMES[c].toLowerCase()}`, title: hl.COLOR_NAMES[c], onclick: () => apply(c) })),
      overlaps ? h("button.hltool__remove", { type: "button", onclick: () => apply(null) }, "Remove") : null);
    place();
  }

  function place() {
    if (!bar) return;
    const sel = getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { hide(); return; }
    const rects = [...sel.getRangeAt(0).getClientRects()].filter(r => r.width > 0);
    if (!rects.length) return;
    const first = rects[0], last = rects[rects.length - 1];
    const bw = bar.offsetWidth, bh = bar.offsetHeight, vw = document.documentElement.clientWidth;
    // desktop: above the start of the selection; phone: below the end, away from the system menu
    let top, left;
    if (coarse()) { top = last.bottom + 14; left = last.right - bw / 2; if (top + bh > innerHeight - 8) top = first.top - bh - 54; }
    else { top = first.top - bh - 10; left = first.left; if (top < 60) top = last.bottom + 10; }
    left = Math.max(8, Math.min(left, vw - bw - 8));
    bar.style.top = top + scrollY + "px"; bar.style.left = left + scrollX + "px";
  }

  function hide() { if (bar) { bar.remove(); bar = null; } ranges = []; }

  async function apply(color) {
    const rs = ranges; if (!rs.length) return;
    const before = rs.flatMap(r => hl.forVerse(r.verseId));
    await hl.paint(rs, color);
    getSelection().removeAllRanges();
    hide();
    if (!color) toast("Highlight removed", { action: "Undo", onAction: async () => { await hl.clear(rs); await hl.restore(before); } });
  }

  let t = null;
  const onSel = () => { clearTimeout(t); t = setTimeout(() => { const s = getSelection(); if (s && !s.isCollapsed && container.contains(s.anchorNode)) show(); else if (!s || s.isCollapsed) hide(); }, coarse() ? 350 : 60); };
  const onUp = () => setTimeout(onSel, 0);
  const onScroll = () => { if (bar) place(); };
  const onKey = e => { if (e.key === "Escape" && bar) { getSelection().removeAllRanges(); hide(); } };
  document.addEventListener("selectionchange", onSel);
  container.addEventListener("mouseup", onUp);
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("keydown", onKey);
  return () => {
    document.removeEventListener("selectionchange", onSel); container.removeEventListener("mouseup", onUp);
    removeEventListener("scroll", onScroll); removeEventListener("keydown", onKey); hide();
  };
}

// true when the range merely touches the token at one boundary
function edgeOnly(range, tok) {
  const r = document.createRange(); r.selectNodeContents(tok);
  return range.compareBoundaryPoints(Range.START_TO_END, r) <= 0     // the selection ends where the token starts
    || range.compareBoundaryPoints(Range.END_TO_START, r) >= 0;        // or starts where it ends
}

/** Paint highlight classes onto rendered tokens. */
export function paintHighlights(container) {
  for (const verseEl of container.querySelectorAll(".verse[data-id]")) {
    const recs = hl.forVerse(verseEl.dataset.id);
    for (const tok of verseEl.querySelectorAll("[data-o]")) {
      tok.classList.remove("hl", "hl-s", "hl-e", ...hl.COLORS.map(c => "hl-" + c));
      delete tok.dataset.hl;
      if (!recs.length) continue;
      const o = +tok.dataset.o, n = +tok.dataset.n;
      const r = recs.find(x => x.start < o + n && x.end > o);
      if (!r) continue;
      tok.classList.add("hl", "hl-" + r.color);
      if (o <= r.start) tok.classList.add("hl-s");
      if (o + n >= r.end) tok.classList.add("hl-e");
      tok.dataset.hl = r.id;
    }
  }
}
