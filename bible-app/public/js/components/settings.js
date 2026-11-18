// Reading settings: pinyin, script, translations, typography.
import { h } from "../core/dom.js";
import * as store from "../core/store.js";
import { openSheet } from "./sheet.js";

export function segmented(options, value, onChange, label) {
  const group = h("div.segmented", { role: "radiogroup", "aria-label": label });
  for (const [val, text, title] of options) {
    group.append(h("button", { type: "button", role: "radio", "aria-checked": String(val === value), title: title || null,
      onclick: () => { [...group.children].forEach(b => b.setAttribute("aria-checked", "false")); group.querySelector(`[data-v="${val}"]`).setAttribute("aria-checked", "true"); onChange(val); },
      "data-v": val }, text));
  }
  return group;
}

export function openSettings() {
  const p = store.get("prefs");
  const set = patch => store.setPrefs(patch);

  const range = (label, key, min, max, step, fmt) => {
    const val = h("span.setting__value", fmt(p[key]));
    const input = h("input.range", { type: "range", min, max, step, value: p[key], "aria-label": label,
      oninput: e => { const v = +e.target.value; val.textContent = fmt(v); set({ [key]: v }); } });
    return h("div.setting", h("div.setting__label", h("span", label), val), input);
  };
  const toggle = (label, key, hint) => {
    const input = h("input", { type: "checkbox", checked: !!p[key], onchange: e => set({ [key]: e.target.checked }) });
    return h("label.setting.switch", h("span", h("span", { style: { fontFamily: "var(--font-display)" } }, label), hint ? h("span.faint", { style: { display: "block", fontSize: "12px" } }, hint) : null), input);
  };

  const body = h("div",
    h("div.setting", h("div.setting__label", h("span", "Pinyin"), h("span.setting__value", "above the characters")),
      segmented([["off", "Off"], ["hard", "Harder words"], ["all", "All words"]], p.pinyin, v => set({ pinyin: v }), "Pinyin")),
    h("div.setting", h("div.setting__label", h("span", "Chinese script"), h("span.setting__value", "Traditional: not yet imported")),
      segmented([["simplified", h("span.zh", "简体 Simplified")], ["traditional", h("span.zh", "繁體 Traditional")]], p.script, v => {
        if (v === "traditional") { setTimeout(() => body.querySelector('[data-v="simplified"]').click(), 250); }
        else set({ script: v });
      }, "Chinese script")),
    h("div.setting", h("div.setting__label", h("span", "Translations")),
      h("div", { style: { fontSize: "13px", lineHeight: "1.6" } },
        h("div", h("span.zh", "新标点和合本"), " · Chinese Union Version (1919 text)"),
        h("div", "World English Bible (WEB)"),
        h("div.faint", { style: { fontSize: "12px" } }, "More translations can be added once their licensing is verified."))),
    range("Chinese size", "zhSize", 16, 34, 1, v => v + " px"),
    range("Pinyin size", "pySize", 9, 16, 0.5, v => v + " px"),
    range("English size", "enSize", 14, 24, 1, v => v + " px"),
    range("Line spacing", "leading", 1.6, 2.8, 0.05, v => v.toFixed(2)),
    range("Column width", "measure", 22, 46, 1, v => v + " em"),
    toggle("Words of Jesus in red", "redLetter", "English text, as marked in the WEB"),
    toggle("Translators’ notes", "showNotes", "Show * markers for footnotes"),
    toggle("Parallel-passage references", "showHeadings", "The CUV’s （太3·1—12…） lines"),
    h("div.setting", { style: { textAlign: "right" } }, h("button.btn.btn--small", { onclick: () => {
      set({ ...store.DEFAULT_PREFS });
      openSettings();
    } }, "Reset typography")));
  openSheet({ title: "Reading settings", body, variant: "panel" });
}
