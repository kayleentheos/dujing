import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { emptySnapshot, isNoop, parseBackup, planImport, toBackup, type UserSnapshot } from "../src";
import { readJSON } from "./helpers";

// the real backup taken from the original app's cloud storage on 2026-11-17
// Your personal backup is kept outside the project (it must never be committed); tests skip without it.
const BACKUP = process.env.DUJING_BACKUP ?? "/home/claude/backups/dujing-backup-2026-11-17-cloud.json";
const d = existsSync(BACKUP) ? describe : describe.skip;
const REAL = existsSync(BACKUP) ? readJSON(BACKUP) : null;

d("backup format", () => {
  it("reads the real backup completely: 16 words, all review answers, settings, progress", () => {
    const { snapshot: s, rejected } = parseBackup(REAL);
    expect(rejected).toEqual([]);
    expect(s.words).toHaveLength(16);
    expect(s.words.reduce((n, w) => n + (w.srs?.history.length ?? 0), 0)).toBe(13);
    expect(s.settings).toMatchObject({ pinyin: "hard", zhSize: 24, redLetter: true });
    expect(s.progress!.books["JHN"]!.read).toEqual([1, 2, 3, 4, 18]);
    expect(s.progress!.last).toMatchObject({ book: "JHN", chapter: 3, verse: 1 });
  });
  it("loses nothing: every field of every original record survives parse → export → parse", () => {
    const a = parseBackup(REAL).snapshot;
    const b = parseBackup(JSON.parse(JSON.stringify(toBackup(a)))).snapshot;
    expect(b).toEqual(a);
    for (const raw of REAL.collections.vocab) expect(a.words.find(w => w.id === raw.data.id)).toEqual(raw.data);
  });
  it("rejects malformed records with a reason instead of dropping them silently", () => {
    const bad = structuredClone(REAL);
    bad.collections.vocab.push({ data: { id: "x|y", word: "z", pinyin: "y", refs: [] } });
    bad.collections.highlights.push({ data: { id: "h", verseId: "JHN.3.16", start: 5, end: 3, color: "red", text: "" } });
    const r = parseBackup(bad);
    expect(r.snapshot.words).toHaveLength(16);
    expect(r.rejected.map(x => x.kind)).toEqual(["word", "highlight"]);
    expect(() => parseBackup({ format: "other" })).toThrow();
  });
});

d("importing", () => {
  const real = () => parseBackup(REAL).snapshot;
  it("imports into an empty account with nothing lost", () => {
    const { merged, report } = planImport(real());
    expect(report).toMatchObject({ wordsAdded: 16, refsAdded: 16, reviewAnswersAdded: 13, settingsImported: true, progressChanged: true, duplicatesSkipped: 0 });
    expect(merged).toEqual(real());
  });
  it("is safe to run twice: the second import adds nothing and creates no duplicates", () => {
    const once = planImport(real()).merged;
    const twice = planImport(real(), once);
    expect(isNoop(twice.report)).toBe(true);
    expect(twice.merged.words).toHaveLength(16);
    expect(twice.merged).toEqual(once);
    expect(twice.report.duplicatesSkipped).toBe(16 + 13);
  });
  it("merges two devices: new verse links and answers are added, the same answer is never counted twice", () => {
    const base = real();
    const other: UserSnapshot = structuredClone(base);
    const w = other.words.find(x => x.word === "太初")!;
    w.refs.push({ ...w.refs[0]!, verseId: "JHN.1.2", verse: 2, zh: "这道太初与　神同在。", en: "The same was in the beginning with God.", addedAt: "2026-11-18T01:00:00Z" });
    w.srs!.history.push({ at: "2026-11-18T12:00:00.000Z", result: "got", interval: 3 });
    w.srs = { ...w.srs!, interval: 3, streak: 2, inReview: false, reps: 3 };
    other.highlights.push({ schema: 1, id: "h1", book: "JHN", chapter: 3, verse: 16, verseId: "JHN.3.16", start: 2, end: 6, text: "神爱世人", color: "yellow", groupId: null, createdAt: "x", updatedAt: "x" });
    const { merged, report } = planImport(other, base);
    expect(report).toMatchObject({ wordsAdded: 0, wordsMerged: 1, refsAdded: 1, reviewAnswersAdded: 1, highlightsAdded: 1 });
    const m = merged.words.find(x => x.word === "太初")!;
    expect(m.refs.map(r => r.verseId)).toEqual(["JHN.1.1", "JHN.1.2"]);
    expect(m.srs!.history.map(h => h.result)).toEqual(["forgot", "got", "got"]);
    expect(m.srs!.interval).toBe(3);                      // schedule from the device that saw the latest answer
    expect(planImport(other, merged).report.wordsMerged).toBe(0);
  });
  it("never overwrites an account's own settings, and unions reading progress", () => {
    const acct = { ...emptySnapshot(), settings: { pinyin: "all" } as any, progress: { books: { JHN: { read: [5], lastChapter: 5 } }, last: { book: "JHN", chapter: 5, verse: null, at: 1 } } };
    const { merged, report } = planImport(real(), acct);
    expect(merged.settings).toEqual({ pinyin: "all" }); expect(report.settingsImported).toBe(false);
    expect(merged.progress!.books["JHN"]!.read).toEqual([1, 2, 3, 4, 5, 18]);
    expect(merged.progress!.last!.chapter).toBe(3);         // the later position wins
  });
});
