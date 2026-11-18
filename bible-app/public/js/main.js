// Entry point: storage, router, view switching.
import { h } from "./core/dom.js";
import { icon } from "./core/icons.js";
import * as storage from "./core/storage.js";
import * as store from "./core/store.js";
import * as router from "./core/router.js";
import { renderLibrary } from "./views/library.js";
import { renderBook, renderSearch, renderAbout } from "./views/pages.js";
import { renderReader, leaveReader } from "./views/reader.js";
import * as highlights from "./data/highlights.js";
import { renderHighlights } from "./views/highlightsList.js";
import { renderBackup } from "./views/backup.js";
import { renderVocab, renderWord, renderStudy, renderSummary } from "./views/vocabulary.js";
import * as vocab from "./data/vocab.js";
import { createNav } from "./components/appNav.js";

const app = document.getElementById("app");
const header = h("header.masthead");
const main = h("div#view");
const nav = createNav();
app.replaceChildren(nav.el, h("div.appmain", header, main));

function defaultHeader() {
  header.replaceChildren(
    h("div.masthead__side", h("a.wordmark", { href: "#home" }, h("span.wordmark__zh", "读经"), h("span.wordmark__en", "Scripture & Mandarin"))),
    h("div.masthead__title"),
    h("div.masthead__side.masthead__side--end",
      h("a.btn.btn--icon", { href: "#search", "aria-label": "Search" }, icon("search")),
      h("a.btn.btn--icon", { href: "#about", "aria-label": "Sources and licensing" }, icon("info"))));
}

let seq = 0;
async function onRoute(route) {
  const mine = ++seq;
  nav.update(route);
  if (route.name !== "read") { leaveReader(); defaultHeader(); }
  try {
    switch (route.name) {
      case "read": await renderReader(main, header, route); break;
      case "book": await renderBook(main, route.book); scrollTo(0, 0); break;
      case "search": await renderSearch(main); break;
      case "about": await renderAbout(main); scrollTo(0, 0); break;
      case "vocab": await renderVocab(main); scrollTo(0, 0); break;
      case "word": await renderWord(main, route.hex); break;
      case "cards": case "study-session": await renderStudy(main); scrollTo(0, 0); break;
      case "study-summary": renderSummary(main); break;
      case "backup": renderBackup(main); break;
      case "highlights": await renderHighlights(main); scrollTo(0, 0); break;
      case "plans": await renderLibrary(main, "plans"); scrollTo(0, 0); break;
      case "notebook": case "study": await renderLibrary(main, "notebook"); scrollTo(0, 0); break;
      default: await renderLibrary(main); scrollTo(0, 0);
    }
  } catch (e) {
    if (mine !== seq) return;
    console.error(e);
    main.replaceChildren(h("main.page", h("p.notice", "Something went wrong loading this page. ", h("a", { href: "#home" }, "Return to the library"), "."), h("pre.faint", { style: { fontSize: "12px", whiteSpace: "pre-wrap" } }, String(e && e.message || e))));
  }
}

store.applyTypography();
main.replaceChildren(h("div.loading", "Opening the library…"));
router.start(onRoute);

// Once the private cloud copy (if any) has been pulled in, refresh state.
storage.init().then(() => {
  if (storage.status.backend === "cloud") {
    store.reload();
    vocab.notify();
    highlights.notify();
    const r = router.parse();
    if (r.name === "home") onRoute(r);
  }
});
