// App navigation: three destinations — Bible, Reading Plans, My Notebook.
// One <nav> element; CSS lays it out as a left sidebar on wide screens and
// as a bottom tab bar on phones (like YouVersion / Du Chinese).
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import * as repo from "../data/repo.js";
import * as store from "../core/store.js";

const ITEMS = [
  { id: "bible", href: "#home", icon: "bible", en: "Bible", short: "Bible", zh: "圣经" },
  { id: "notebook", href: "#notebook", icon: "notebook", en: "My Notebook", short: "Notebook", zh: "笔记本" },
  { id: "plans", href: "#plans", icon: "plans", en: "Reading Plans", short: "Plans", zh: "计划" },
];
// which destination each route belongs to
const SECTION = {
  home: "bible", book: "bible", read: "bible", search: "bible", about: "bible",
  plans: "plans",
  notebook: "notebook", vocab: "notebook", word: "notebook", cards: "notebook", study: "notebook",
  "study-session": "notebook", "study-summary": "notebook", highlights: "notebook", backup: "notebook",
};
const KEY = "dujing:nav-collapsed";

export function createNav() {
  const links = ITEMS.map(it => h("a.appnav__item", { href: it.href, "data-id": it.id, title: it.en },
    icon(it.icon),
    h("span.appnav__label", h("span.appnav__en", it.en), it.short ? h("span.appnav__short", it.short) : null),
    h("span.appnav__zh.zh", it.zh)));
  const recent = h("div.appnav__recent");
  const collapse = h("button.appnav__collapse", { type: "button", "aria-label": "Collapse sidebar", title: "Collapse sidebar",
    onclick: () => setCollapsed(!document.body.classList.contains("nav-collapsed")) }, icon("sidebar"));
  const nav = h("nav.appnav", { "aria-label": "Main" },
    h("div.appnav__brand",
      h("a.wordmark", { href: "#home" }, h("span.wordmark__zh", "读经"), h("span.wordmark__en", "Scripture & Mandarin")),
      collapse),
    h("div.appnav__items", links),
    recent);
  try { if (localStorage.getItem(KEY) === "1") document.body.classList.add("nav-collapsed"); } catch { }

  function setCollapsed(on) {
    document.body.classList.toggle("nav-collapsed", on);
    collapse.setAttribute("aria-label", on ? "Expand sidebar" : "Collapse sidebar");
    collapse.title = on ? "Expand sidebar" : "Collapse sidebar";
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { }
  }

  async function update(route) {
    const sec = SECTION[route.name] || "bible";
    for (const a of links) {
      const on = a.dataset.id === sec;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    // flashcard sessions are full-screen on phones (no tab bar), like Du Chinese lessons
    document.body.classList.toggle("is-focus", route.name === "study-session" || route.name === "cards");
    // "Recent": where you stopped reading
    const last = store.get("progress")?.last;
    if (!last) { recent.replaceChildren(); return; }
    try {
      const canon = await repo.canon();
      const b = canon.books.find(x => x.code === last.book);
      if (!b) return;
      const ref = `${last.chapter}${last.verse ? ":" + last.verse : ""}`;
      recent.replaceChildren(h("div.appnav__heading.smallcaps", "Recent"),
        h("a.appnav__recentlink", { href: `#read-${last.book}-${last.chapter}${last.verse ? "-" + last.verse : ""}` },
          icon("bookmark"), h("span", h("span.zh", b.name.zh), " ", ref), h("span.appnav__tag", "CUV")));
    } catch { }
  }
  return { el: nav, update };
}
