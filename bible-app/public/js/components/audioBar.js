// The listening bar: compact, at the foot of the reading column; stays
// reachable while scrolling. Shows the verse being read, chapter progress,
// play/pause, previous / replay / next verse, speed and chapter/verse mode.
import { h } from "../core/dom.js";
import * as player from "../audio/player.js";

const SVG = {
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="7" y="5.5" width="3.6" height="13" rx=".6" fill="currentColor" stroke="none"/><rect x="13.4" y="5.5" width="3.6" height="13" rx=".6" fill="currentColor" stroke="none"/>',
  prev: '<path d="M7 6v12M18 6l-8 6 8 6z" fill="currentColor"/>',
  next: '<path d="M17 6v12M6 6l8 6-8 6z" fill="currentColor"/>',
  replay: '<path d="M5 12a7 7 0 1 0 2.2-5.1M5 4.5v3.4h3.4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const ico = (n, size = 20) => { const s = document.createElement("span"); s.style.display = "inline-flex"; s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[n]}</svg>`; return s.firstChild; };
const fmt = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function createAudioBar({ bookZh, bookEn, onClose, onFollowEnglish }) {
  const ref = h("span.abar__ref");
  const time = h("span.abar__time");
  const fill = h("i");
  const progress = h("div.abar__progress", { role: "progressbar", "aria-label": "Chapter progress", "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
  const playBtn = h("button.abar__btn.abar__play", { type: "button", onclick: () => player.toggle(), "aria-label": "Play" });
  const rateBtn = h("button.abar__btn.abar__rate", { type: "button", onclick: () => player.cycleRate(), "aria-label": "Playback speed" });
  const modeBtn = h("button.abar__btn.abar__mode", { type: "button", onclick: () => player.setMode(player.snapshot().mode === "chapter" ? "verse" : "chapter") });
  const enBtn = h("button.abar__btn.abar__en", { type: "button", "aria-pressed": "false", onclick: () => { const on = enBtn.getAttribute("aria-pressed") !== "true"; enBtn.setAttribute("aria-pressed", String(on)); onFollowEnglish(on); }, title: "Show the English of the verse being read" }, "EN");
  const note = h("p.abar__note");
  const bar = h("div.abar", { role: "region", "aria-label": "Audio player" },
    h("div.abar__top", ref, time,
      h("button.abar__btn.abar__close", { type: "button", onclick: onClose, "aria-label": "Close audio player" }, ico("close", 16))),
    progress,
    h("div.abar__controls",
      h("div.abar__side", modeBtn, enBtn),
      h("div.abar__main",
        h("button.abar__btn", { type: "button", onclick: () => player.prev(), "aria-label": "Previous verse" }, ico("prev")),
        h("button.abar__btn", { type: "button", onclick: () => player.replay(), "aria-label": "Replay this verse" }, ico("replay")),
        playBtn,
        h("button.abar__btn", { type: "button", onclick: () => player.next(), "aria-label": "Next verse" }, ico("next"))),
      h("div.abar__side.abar__side--end", rateBtn)),
    note);

  // Only touch the DOM when something visible changed: the player reports ~60×/s
  // while playing, and replacing the button's icon under a finger makes iPhone
  // Safari drop the tap (the pause button then seems dead).
  let shownPlaying = null, shownNote = null;
  const unsub = player.subscribe(s => {
    const seg = s.segment;
    const [, c, v] = seg ? seg.verseId.split(".") : [];
    ref.textContent = seg ? `${bookZh} ${c}:${v} · ${bookEn} ${c}:${v}` : "";
    time.textContent = s.track ? `${fmt(s.elapsed)} / ${fmt(s.track.total)}` : "";
    fill.style.width = (s.progress * 100).toFixed(2) + "%";
    progress.setAttribute("aria-valuenow", String(Math.round(s.progress * 100)));
    const busy = s.playing || !!s.loading;
    if (busy !== shownPlaying) {
      shownPlaying = busy;
      playBtn.replaceChildren(ico(busy ? "pause" : "play", 24));
      playBtn.setAttribute("aria-label", busy ? "Pause" : "Play");
    }
    playBtn.classList.toggle("is-loading", !!s.loading);
    rateBtn.textContent = `${s.rate}×`;
    modeBtn.textContent = s.mode === "chapter" ? "Chapter" : "One verse";
    modeBtn.title = s.mode === "chapter" ? "Plays on through the chapter (tap for one verse at a time)" : "Stops after each verse (tap to play the whole chapter)";
    const m = s.track && s.track.meta;
    const noteKey = `${s.error}|${m && m.kind}|${m && m.checked}|${m && m.review && m.review.status}`;
    if (noteKey === shownNote) return;
    shownNote = noteKey;
    note.replaceChildren(h("span",
      s.error ? h("span.abar__err", s.error + " ") : null,
      m ? (m.kind === "synthesized"
        ? [`Synthesized voice (${m.provider}, ${m.voice}). `, m.review && m.review.status === "reviewed" ? `Pronunciation reviewed${m.review.by ? " by " + m.review.by : ""}.` : h("span.abar__warn", m.checked === false ? "Recording not yet checked; pronunciation not yet reviewed by a Mandarin speaker." : "Pronunciation not yet reviewed by a Mandarin speaker.")]
        : `${m.label}.`) : null));
  });
  return { el: bar, destroy: () => { unsub(); bar.remove(); } };
}
