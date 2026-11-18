import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createBibleRepo } from "@dujing/core";
import { createServices, memoryStore } from "../src";

// Your personal backup is kept outside the project (it must never be committed); tests skip without it.
const BACKUP = process.env.DUJING_BACKUP ?? "/home/claude/backups/dujing-backup-2026-11-17-cloud.json";
const d = existsSync(BACKUP) ? describe : describe.skip;
const REAL = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, "utf8")) : null;
const repo = createBibleRepo({ async getJSON(p) { return JSON.parse(readFileSync(new URL(`../../../apps/web/public/content/${p}`, import.meta.url), "utf8")); } });

d("services over a store", () => {
  it("imports the real backup, then a second import writes nothing new", async () => {
    const store = memoryStore(), svc = createServices(store);
    const first = await svc.backup.import(REAL);
    expect(first.report).toMatchObject({ wordsAdded: 16, reviewAnswersAdded: 13, settingsImported: true });
    const afterFirst = JSON.stringify(store.dump());
    const second = await svc.backup.import(REAL);
    expect(second.report).toMatchObject({ wordsAdded: 0, wordsMerged: 0, refsAdded: 0, reviewAnswersAdded: 0, highlightsAdded: 0, progressChanged: false, settingsImported: false });
    expect(JSON.stringify(store.dump())).toBe(afterFirst);
    expect(await svc.vocab.list()).toHaveLength(16);
  });
  it("exports what it imported, field for field", async () => {
    const svc = createServices(memoryStore());
    await svc.backup.import(REAL);
    const out = await svc.backup.export();
    const byId = new Map(out.collections.vocab.map(x => [x.data.id, x.data]));
    for (const raw of REAL.collections.vocab) expect(byId.get(raw.data.id)).toEqual(raw.data);
    expect(out.docs.prefs.data).toEqual(REAL.docs.prefs.data);
    expect(out.docs.progress.data).toEqual(REAL.docs.progress.data);
  });
  it("runs the reading → save → study → highlight loop", async () => {
    const svc = createServices(memoryStore());
    const ch = await repo.chapter("JHN", 1); const lex = await repo.lexicon("JHN");
    const row = ch.rows.find(r => r.key === "JHN.1.4")!; const v = row.zh[0]!;
    const ctx = { verseId: v.id, book: "JHN", bookZh: "约翰福音", bookEn: "John", chapter: 1, verse: 4, zh: v.text, en: row.en.map(e => e.text).join(" ") };
    expect((await svc.vocab.save(lex.entries["生命|shēng mìng"]!, ctx)).status).toBe("created");
    expect((await svc.vocab.save(lex.entries["生命|shēng mìng"]!, ctx)).status).toBe("exists");
    const sess = await svc.study.session();
    expect(sess.cards).toEqual(["生命|shēng mìng"]);
    const w = await svc.study.answer("生命|shēng mìng", "forgot");
    expect(w!.srs!.inReview).toBe(true);
    const created = await svc.highlights.paint([{ verseId: v.id, start: 0, end: 2, verseText: v.text }], "pink");
    expect(created[0]!.text).toBe("生命");
    expect(await svc.highlights.list({ book: "JHN", chapter: 1 })).toHaveLength(1);
    await svc.highlights.remove(created[0]!.id);
    expect(await svc.highlights.list()).toHaveLength(0);
    expect(await svc.bookmarks.toggle("JHN.3.16")).toMatchObject({ chapter: 3, verse: 16 });
    expect(await svc.bookmarks.toggle("JHN.3.16")).toBeNull();
    await svc.reading.setPosition("JHN", 1, 4); await svc.reading.markChapterRead("JHN", 1);
    expect(await svc.reading.getProgress()).toMatchObject({ books: { JHN: { read: [1], lastChapter: 1 } }, last: { chapter: 1, verse: 4 } });
  });
});
