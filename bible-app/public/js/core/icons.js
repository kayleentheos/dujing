// Minimal line icons (inline SVG), drawn to match the thin-rule aesthetic.
const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  type: '<path d="M4 18L9 6l5 12M5.8 14h6.4M15 18l3-7 3 7M15.9 16h4.2"/>',
  book: '<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  list: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="1"/><path d="M5 15V5h10"/>',
  bookmark: '<path d="M7 4h10v16l-5-4-5 4z"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  marker: '<path d="M5 19h6M9 15l-2 2M14 4l6 6-8 8-6-6z"/>',
  share: '<path d="M12 4v11M8 8l4-4 4 4M5 13v6h14v-6"/>',
  translate: '<path d="M4 6h8M8 4v2c0 4-2 7-4 8M6 10c1 2 3 3.5 6 4"/><path d="M13 20l3.5-8 3.5 8M14.3 17h4.4"/>',
  notebook: '<rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M9 3.5v17M12 8h4M12 11h4"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8v.01"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  plans: '<rect x="4" y="5" width="16" height="15" rx="1"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4M8 14l2.5 2.5L16 12"/>',
  bible: '<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>',
  sidebar: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M9.5 5v14"/>',
};
export function icon(name, label) {
  const span = document.createElement("span");
  span.style.display = "inline-flex";
  span.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;
  if (label) span.setAttribute("aria-label", label);
  return span.firstChild;
}
