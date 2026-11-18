import { describe, expect, it, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBibleRepo, isWord } from "../src";
import { CONTENT, diskSource } from "./helpers";

const repo = createBibleRepo(diskSource);
let Orig: any;
beforeAll(async () => {
  // run the original app's repository against the same files, for parity
  vi.stubGlobal("fetch", async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(resolve(CONTENT, url.replace(/^data\//, "")), "utf8")) }));
  // @ts-ignore
  Orig = await import("../../../../bible-app/public/js/data/repo.js");
});

describe("Bible content", () => {
  it("assembles all 21 chapters of John exactly like the original app", async () => {
    for (let ch = 1; ch <= 21; ch++) {
      const a = await repo.chapter("JHN", ch), b = await Orig.chapter("JHN", ch);
      expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
    }
  });
  it("keeps every CUV verse's tokens identical to its text in every imported book (no altered Scripture)", async () => {
    const counts: Record<string, number> = {};
    for (const b of (await repo.canon()).books.filter(b => b.imported)) {
      counts[b.code] = 0;
      for (let ch = 1; ch <= b.chapters; ch++) for (const row of (await repo.chapter(b.code, ch)).rows) for (const v of row.zh) {
        expect(v.tokens!.filter(isWord).map(t => t[0]).join("")).toBe(v.text); counts[b.code]!++;
      }
    }
    expect(counts).toMatchObject({ MRK: 676, JHN: 877, "1JN": 105, "2JN": 13, "3JN": 15 });
  });
  it("assembles 1 John exactly like the original app", async () => {
    for (let ch = 1; ch <= 5; ch++) expect(JSON.parse(JSON.stringify(await repo.chapter("1JN", ch)))).toEqual(JSON.parse(JSON.stringify(await Orig.chapter("1JN", ch))));
    expect(await repo.parseReference("约翰一书 4:8")).toMatchObject({ book: "1JN", chapter: 4, verse: 8 });
    expect(await repo.parseReference("3 John 4")).toMatchObject({ book: "3JN", chapter: 1, verse: 4 });
    expect(await repo.parseReference("约二 6")).toEqual(await Orig.parseReference("约二 6"));
    for (let ch = 1; ch <= 16; ch++) expect(JSON.parse(JSON.stringify(await repo.chapter("MRK", ch)))).toEqual(JSON.parse(JSON.stringify(await Orig.chapter("MRK", ch))));
    expect(await repo.parseReference("马可福音 10:45")).toMatchObject({ book: "MRK", chapter: 10, verse: 45 });
    for (const b of ["2JN", "3JN"]) expect(JSON.parse(JSON.stringify(await repo.chapter(b, 1)))).toEqual(JSON.parse(JSON.stringify(await Orig.chapter(b, 1))));
  });
  it("parses references in English and Chinese", async () => {
    for (const q of ["John 3:16", "约翰福音 3:16", "joh 3:16", "约 3：16", "JHN 3 16"]) {
      const r = await repo.parseReference(q);
      expect(r, q).toMatchObject({ book: "JHN", chapter: 3 });
      expect(r).toEqual(await Orig.parseReference(q));
    }
    expect(await repo.parseReference("John 22")).toBeNull();
  });
  it("searches both translations like the original", async () => {
    for (const q of ["永生", "eternal life", "恩典"]) {
      const a = (await repo.search(q)).map(h => [h.tid, h.verse.id, h.at]);
      const b = (await Orig.search(q)).map((h: any) => [h.tid, h.verse.id, h.at]);
      expect(a).toEqual(b);
    }
  });
});
