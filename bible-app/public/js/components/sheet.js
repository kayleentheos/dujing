// A sheet: bottom sheet on phones, anchored panel / floating bar on desktop.
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";

let open = null;

export function openSheet({ title, body, variant = "panel", modal = true, onClose, label }) {
  closeSheet();
  const scrim = modal ? h("div.scrim", { onclick: () => closeSheet() }) : null;
  const sheet = h(`div.sheet.sheet--${variant}`, { role: "dialog", "aria-modal": modal ? "true" : "false", "aria-label": label || title || "Panel" },
    h("div.sheet__grabber"),
    title ? h("div.sheet__head", h("h2.sheet__title", title),
      h("button.btn.btn--icon", { onclick: () => closeSheet(), "aria-label": "Close" }, icon("close"))) : null,
    h("div", { class: title ? "sheet__body" : "" }, body));
  if (scrim) document.body.append(scrim);
  document.body.append(sheet);
  requestAnimationFrame(() => { scrim && scrim.classList.add("is-open"); sheet.classList.add("is-open"); });
  const onKey = e => { if (e.key === "Escape") closeSheet(); };
  document.addEventListener("keydown", onKey);
  open = { scrim, sheet, onKey, onClose };
  return sheet;
}

export function closeSheet() {
  if (!open) return;
  const { scrim, sheet, onKey, onClose } = open;
  open = null;
  document.removeEventListener("keydown", onKey);
  sheet.classList.remove("is-open"); scrim && scrim.classList.remove("is-open");
  setTimeout(() => { sheet.remove(); scrim && scrim.remove(); }, 230);
  onClose && onClose();
}

export const isOpen = () => !!open;
