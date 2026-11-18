// "Back up my data": a complete copy of everything saved for this user —
// vocabulary (with review history), highlights, reading settings and reading
// progress — as one JSON file (format "dujing-backup" v1, the same format the
// new web app imports).
import { h, toast } from "../core/dom.js";
import * as storage from "../core/storage.js";
import * as store from "../core/store.js";
import * as vocab from "../data/vocab.js";
import * as highlights from "../data/highlights.js";

export function buildBackup() {
  const docs = {}, collections = {};
  for (const name of ["prefs", "progress"]) docs[name] = { data: store.get(name) };
  collections.vocab = vocab.all().map(r => ({ data: r }));
  collections.highlights = highlights.all().map(r => ({ data: r }));
  return {
    format: "dujing-backup", formatVersion: 1, exportedAt: new Date().toISOString(),
    source: { app: "读经 Claude artifact", method: "in-app export", storage: storage.status.backend },
    docs, collections,
  };
}

export function renderBackup(root) {
  const b = buildBackup();
  const json = JSON.stringify(b, null, 1);
  const reviews = b.collections.vocab.reduce((n, x) => n + ((x.data.srs && x.data.srs.history) || []).length, 0);
  const name = `dujing-backup-${b.exportedAt.slice(0, 10)}.json`;
  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("Backup file downloaded");
    } catch { toast("Download blocked here — use Copy instead"); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); toast("Backup copied — paste it into a text file to keep it"); }
    catch { area.hidden = false; area.select(); toast("Select all the text below and copy it"); }
  };
  const area = h("textarea.backup-text", { readonly: true, hidden: true, rows: 10 }, json);
  root.replaceChildren(h("main.page.backup-page",
    h("div.folio", h("h1.folio__title", "Back up my data", h("span.zh", "备份")), h("a.folio__meta", { href: "#notebook" }, "← My Notebook")),
    h("p.lede-small", "A complete copy of everything you have saved in 读经, as one file. Keep it somewhere safe; the new version of the app will be able to import it."),
    h("ul.backup-list",
      h("li", h("b", String(b.collections.vocab.length)), " vocabulary words, with every verse they are linked to"),
      h("li", h("b", String(reviews)), " flashcard answers (review history and next review dates)"),
      h("li", h("b", String(b.collections.highlights.length)), " highlights"),
      h("li", "Reading settings and reading progress")),
    h("div.word-actions",
      h("button.btn.btn--primary", { type: "button", onclick: download }, "Download backup file"),
      h("button.btn.btn--outline", { type: "button", onclick: copy }, "Copy backup text"),
      h("button.btn", { type: "button", onclick: () => { area.hidden = !area.hidden; } }, "Show the data")),
    area,
    h("p.faint", { style: { fontSize: "12px", marginTop: "16px" } }, `Saved ${storage.status.backend === "cloud" ? "to your account and this browser" : "in this browser"}. The file contains only your own data, not the Bible text or dictionary.`)));
  scrollTo(0, 0);
}
