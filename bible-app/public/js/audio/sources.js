// Audio sources. The reader never talks to a speech provider: it asks this
// module for "the track for John 1" and receives a list of verse segments.
//
// A source is described by data/audio/<set>/manifest.json:
// {
//   set, label, kind: "synthesized" | "recording",
//   provider, voice, license, generated,
//   textRule: how the spoken text relates to the stored text,
//   chapters: {
//     "JHN.1": {
//       review: { status: "not-reviewed" | "reviewed", by, date, notes },
//       check: { method, flagged: [verseIds] },
//       // EITHER one file per verse ...
//       verses: { "JHN.1.1": { file, duration } , ... }
//       // ... OR one recording with verse timings (a future human recording)
//       // file, timings: { "JHN.1.1": [start, end], ... }
//     }
//   }
// }
// Both shapes become the same Track: { segments: [{ verseId, file, start, end, duration }] }.
const BASE = "data/audio/";
const SETS = ["azure-yunyang"];          // in order of preference; add a recording here later
const manifests = new Map();

async function manifest(set) {
  if (!manifests.has(set)) {
    manifests.set(set, fetch(`${BASE}${set}/manifest.json`, { cache: "no-cache" })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(() => { manifests.delete(set); return null; }));      // a failure is retried next time
  }
  return manifests.get(set);
}

/** Chapters that have audio, e.g. ["JHN.1"], for messages. */
export async function availableChapters() {
  const out = [];
  for (const set of SETS) { const m = await manifest(set); if (m) out.push(...Object.keys(m.chapters || {})); }
  return [...new Set(out)];
}

/** The best available track for a chapter, or null if there is no audio for it. */
export async function trackFor(book, chapter) {
  for (const set of SETS) {
    const m = await manifest(set);
    const ch = m && m.chapters && m.chapters[`${book}.${chapter}`];
    if (!ch) continue;
    let segments;
    if (ch.verses) {
      segments = Object.entries(ch.verses).map(([verseId, v]) => ({
        verseId, file: `${BASE}${set}/${v.file}`, start: 0, end: v.duration, duration: v.duration }));
    } else if (ch.file && ch.timings) {
      segments = Object.entries(ch.timings).map(([verseId, [s, e]]) => ({
        verseId, file: `${BASE}${set}/${ch.file}`, start: s, end: e, duration: e - s }));
    } else continue;
    segments.sort((a, b) => +a.verseId.split(".")[2] - +b.verseId.split(".")[2]);
    return {
      book, chapter, set, segments,
      total: segments.reduce((n, s) => n + s.duration, 0),
      meta: { label: m.label, kind: m.kind, provider: m.provider, voice: m.voice, license: m.license, review: ch.review || null, checked: !(ch.check && ch.check.checked === false) },
    };
  }
  return null;
}
