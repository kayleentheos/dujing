import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contextualMeaning, createBibleRepo, definitionOf, fromHexId, hexId, isWord, matchSenses, saveWord, detachRef, recordAnswer, resetProgress } from "../src";
import { diskSource } from "./helpers";

// the original functions, evaluated from their source files (they live in DOM modules)
const origSrc = readFileSync(new URL("../../../../bible-app/public/js/components/wordPopover.js", import.meta.url), "utf8");
const block = origSrc.slice(origSrc.indexOf("const STOP"), origSrc.indexOf("export const hexId"));
const origMatch = new Function(block.replace("export function matchSenses", "function matchSenses") + "; return matchSenses;")();
const vocabSrc = readFileSync(new URL("../../../../bible-app/public/js/data/vocab.js", import.meta.url), "utf8");
const defBlock = vocabSrc.slice(vocabSrc.indexOf("export function definitionOf"), vocabSrc.indexOf("// ---- spaced repetition"));
const origDef = new Function(defBlock.replace("export function", "function") + "; return definitionOf;")();

const repo = createBibleRepo(diskSource);

describe("dictionary", () => {
  it("matches senses to the English verse exactly like the original, for every word in John", async () => {
    const lex = await repo.lexicon("JHN");
    let n = 0;
    for (let ch = 1; ch <= 21; ch++) for (const row of (await repo.chapter("JHN", ch)).rows) {
      const en = row.en.map(v => v.text).join(" ");
      for (const v of row.zh) for (const t of v.tokens ?? []) {
        if (!isWord(t)) continue;
        const e = lex.entries[`${t[0]}|${t[1]}`]; if (!e) continue;
        expect([...matchSenses(e.senses ?? [], en)]).toEqual([...origMatch(e.senses ?? [], en)]); n++;
      }
    }
    expect(n).toBeGreaterThan(15000);
  });
  it("defines every lexicon entry exactly like the original (never invented)", async () => {
    const lex = await repo.lexicon("JHN");
    for (const e of Object.values(lex.entries)) expect(definitionOf(e)).toBe(origDef(e));
  });
  it("round-trips word ids used in links", () => {
    for (const id of ["生命|shēng mìng", "道|dào", "拿撒勒|ná sǎ lè"]) expect(fromHexId(hexId(id))).toBe(id);
  });
});

describe("vocabulary", () => {
  it("saves once, attaches further verses, never duplicates", async () => {
    const lex = await repo.lexicon("JHN"); const e = lex.entries["生命|shēng mìng"]!;
    const ctx = (v: number, zh: string, en: string) => ({ verseId: `JHN.1.${v}`, book: "JHN", bookZh: "约翰福音", bookEn: "John", chapter: 1, verse: v, zh, en });
    const a = saveWord(null, e, ctx(4, "生命在他里头，这生命就是人的光。", "In him was life, and the life was the light of men."), "2026-11-17T00:00:00Z");
    expect(a.status).toBe("created"); expect(a.record.refs[0]!.contextual).toBe(e.senses![0]);
    const again = saveWord(a.record, e, ctx(4, "x", "y"));
    expect(again.status).toBe("exists"); expect(again.record.refs).toHaveLength(1);
    const b = saveWord(a.record, e, ctx(5, "光照在黑暗里，黑暗却不接受光。", "The light shines in the darkness, and the darkness hasn’t overcome it."));
    expect(b.status).toBe("attached"); expect(b.record.refs.map(r => r.verseId)).toEqual(["JHN.1.4", "JHN.1.5"]);
    expect(detachRef(b.record, "JHN.1.4")!.firstRef).toBe("JHN.1.5");
    expect(detachRef(a.record, "JHN.1.4")).toBeNull();
    const studied = recordAnswer(a.record, "forgot", Date.parse("2026-11-17T12:00:00Z"));
    expect(studied.srs!.inReview).toBe(true);
    expect(resetProgress(studied).srs).toBeUndefined();
  });
});
