// Notebook: every highlight, grouped by book and chapter, with a link back to the verse.
import { h, toast } from "../core/dom.js";
import * as hl from "../data/highlights.js";
import * as repo from "../data/repo.js";

export async function renderHighlights(root) {
  const canon = await repo.canon();
  let color = "all";
  const list = h("div.hl-list");
  const filters = h("div.hl-filters");
  root.replaceChildren(h("main.page.hl-page",
    h("div.folio", h("h1.folio__title", "Highlights", h("span.zh", "标记")), h("a.folio__meta", { href: "#notebook" }, "← My Notebook")),
    filters, list));

  const paint = () => {
    const all = hl.all();
    filters.replaceChildren(
      h("button.hl-filter", { type: "button", "aria-pressed": String(color === "all"), onclick: () => { color = "all"; paint(); } }, `All ${all.length}`),
      ...hl.COLORS.filter(c => all.some(r => r.color === c)).map(c => h("button.hl-filter", { type: "button", "aria-pressed": String(color === c), onclick: () => { color = c; paint(); } },
        h("span.hl-swatch.hl-swatch--small", { "data-color": c }), `${hl.COLOR_NAMES[c]} ${all.filter(r => r.color === c).length}`)));
    const recs = all.filter(r => color === "all" || r.color === color);
    if (!recs.length) {
      list.replaceChildren(h("p.vocab-empty", all.length ? "No highlights in this colour." : "No highlights yet. While reading, select some Chinese text (or tap a word) and choose a colour.", " ", h("a", { href: "#read-JHN-1" }, "Open John 1")));
      return;
    }
    const order = c => canon.books.findIndex(b => b.code === c);
    recs.sort((a, b) => order(a.book) - order(b.book) || a.chapter - b.chapter || a.verse - b.verse || a.start - b.start);
    const out = []; let last = "";
    for (const r of recs) {
      const b = canon.books.find(x => x.code === r.book);
      const key = `${r.book}.${r.chapter}`;
      if (key !== last) { out.push(h("h2.hl-chapter", h("span.zh", `${b ? b.name.zh : r.book} 第${r.chapter}章`), ` ${b ? b.name.en : r.book} ${r.chapter}`)); last = key; }
      out.push(h("div.hl-row",
        h("a.hl-row__text.zh", { href: `#read-${r.book}-${r.chapter}-${r.verse}` }, h("span", { class: `hl hl-s hl-e hl-${r.color}` }, r.text)),
        h("span.hl-row__ref", `${r.chapter}:${r.verse}`),
        h("button.linkish", { type: "button", onclick: async () => { const gone = await hl.remove(r.id); toast("Highlight removed", { action: "Undo", onAction: () => hl.restore(gone) }); } }, "Remove")));
    }
    list.replaceChildren(...out);
  };
  const unsub = hl.subscribe(paint);
  window.addEventListener("hashchange", unsub, { once: true });
  paint();
}
