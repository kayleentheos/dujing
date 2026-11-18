// Hash router. The host passes only plain #names (letters, digits, hyphens),
// so routes are encoded as: #home, #book-JHN, #read-JHN-3, #read-JHN-3-16,
// #search, #about, #vocab, #cards, #word-<hex of word--pinyin>
export function parse(hash = location.hash) {
  const h = hash.replace(/^#/, "");
  if (!h || h === "home") return { name: "home" };
  let m;
  if ((m = h.match(/^book-([0-9A-Z]{3})$/))) return { name: "book", book: m[1] };
  if ((m = h.match(/^read-([0-9A-Z]{3})-(\d+)(?:-(\d+))?$/)))
    return { name: "read", book: m[1], chapter: +m[2], verse: m[3] ? +m[3] : null };
  if ((m = h.match(/^word-([0-9a-f-]+)$/))) return { name: "word", hex: m[1] };
  if (/^(search|about|notebook|vocab|cards|study|study-session|study-summary|highlights|backup)$/.test(h)) return { name: h };
  return { name: "home" };
}

export function href(route) {
  switch (route.name) {
    case "book": return `#book-${route.book}`;
    case "read": return `#read-${route.book}-${route.chapter}${route.verse ? "-" + route.verse : ""}`;
    case "home": return "#home";
    case "word": return `#word-${route.hex}`;
    default: return "#" + route.name;
  }
}

export function go(route, { replace = false } = {}) {
  const target = href(route);
  const same = location.hash === target;
  if (replace) { try { history.replaceState(null, "", target); } catch { location.hash = target; return; } }
  else if (!same) { location.hash = target; return; }   // native hashchange follows
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function start(onRoute) {
  const run = () => onRoute(parse());
  window.addEventListener("hashchange", run);
  run();
}
