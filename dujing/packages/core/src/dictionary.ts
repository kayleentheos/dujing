// Dictionary helpers. Definitions only ever come from the lexicon (CC-CEDICT
// and reviewed study notes); when there is nothing, say so — never invent.
import type { LexiconEntry } from "./types";

export function definitionOf(entry: LexiconEntry): string {
  if (entry.senses && entry.senses.length) return entry.senses.slice(0, 3).join("; ");
  if (entry.kind === "name") return "Proper name (transliteration)";
  if (entry.kind === "transliteration" && entry.note) return entry.note.text.split(" — ")[0]!;
  if (entry.kind === "parts" && entry.parts) return entry.parts.map(p => `${p.w} ${p.senses && p.senses[0] ? p.senses[0] : "—"}`).join(" + ");
  return "Definition not available";
}

const STOP = new Set("a an the of to in on at by for and or as is be (bound form) form bound one some something someone sb sth used etc with from into that this it its his her their our your my".split(" "));
const stem = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "").replace(/(ing|ed|es|s)$/, "");

/** Which dictionary senses appear in the English of the verse (WEB): indexes of matching senses. */
export function matchSenses(senses: string[], en: string | null | undefined): Set<number> {
  const words = new Set((en || "").toLowerCase().split(/[^a-z’']+/).map(stem).filter(Boolean));
  const hit = new Set<number>();
  senses.forEach((s, i) => {
    const core = s.replace(/\([^)]*\)/g, " ").split(/[;,/]/).map(x => x.trim()).filter(Boolean);
    for (const phrase of core) {
      const ws = phrase.split(/\s+/).map(stem).filter(x => x && !STOP.has(x) && x.length > 2);
      if (ws.length && ws.every(x => words.has(x))) { hit.add(i); break; }
    }
  });
  return hit;
}

/** Meaning of the word in this verse: the study note for the verse, else the first sense the English matches. */
export function contextualMeaning(entry: LexiconEntry, verseId: string, en: string): string | null {
  const note = entry.note?.verses?.[verseId];
  if (note) return note;
  const first = [...matchSenses(entry.senses ?? [], en)][0];
  return first === undefined ? null : entry.senses![first]!;
}

/** Stable URL-safe id for a word ("生命|shēng mìng" ↔ "751f-547d--73-68-113-...") — same as the original app's #word- links. */
export const hexId = (id: string) => [...id.split("|")[0]!].map(c => c.codePointAt(0)!.toString(16)).join("-") + "--" +
  [...(id.split("|")[1] || "")].map(c => c.codePointAt(0)!.toString(16)).join("-");
export const fromHexId = (s: string) => {
  const [a, b] = s.split("--");
  const dec = (x?: string) => (x ? x.split("-").map(hx => String.fromCodePoint(parseInt(hx, 16))).join("") : "");
  return `${dec(a)}|${dec(b)}`;
};
