import { describe, expect, it } from "vitest";
import { paint, trimRange, snapToTokens, highlightAt, groupOf, type Highlight } from "../src";

const T16 = "「　神爱世人，甚至将他的独生子赐给他们，叫一切信他的，不致灭亡，反得永生。";
const T17 = "因为　神差他的儿子降世，不是要定世人的罪，乃是要叫世人因他得救。";
let n = 0; const newId = () => "h" + ++n;
const apply = (all: Highlight[], r: ReturnType<typeof paint>) => [...all.filter(h => !r.remove.includes(h.id) && !r.put.some(p => p.id === h.id)), ...r.put];

describe("highlights", () => {
  it("trims punctuation and spaces at the edges", () => {
    expect(trimRange(T16, 0, 7)).toEqual([2, 6]);       // 「　神爱世人， -> 神爱世人
  });
  it("snaps a range to whole words", () => {
    const toks: any = [["神", "shén"], ["爱", "ài"], ["世人", "shì rén"]];
    expect(snapToTokens(toks, 3, 4)).toEqual([2, 4]);   // half of 世人 -> the whole word
  });
  it("paints, recolours a part, removes a part, merges same colour", () => {
    let all: Highlight[] = [];
    all = apply(all, paint(all, [{ verseId: "JHN.3.16", start: 0, end: 7, verseText: T16 }], "yellow", { newId }));
    expect(all.map(h => [h.text, h.color])).toEqual([["神爱世人", "yellow"]]);
    all = apply(all, paint(all, [{ verseId: "JHN.3.16", start: 3, end: 4, verseText: T16 }], "blue", { newId }));
    expect(all.map(h => [h.text, h.color]).sort()).toEqual([["爱", "blue"], ["神", "yellow"], ["世人", "yellow"]].sort());
    all = apply(all, paint(all, [{ verseId: "JHN.3.16", start: 3, end: 4, verseText: T16 }], null, { newId }));
    expect(all.map(h => h.text).sort()).toEqual(["世人", "神"].sort());
    all = apply(all, paint(all, [{ verseId: "JHN.3.16", start: 2, end: 6, verseText: T16 }], "yellow", { newId }));
    expect(all.map(h => h.text)).toEqual(["神爱世人"]);
    expect(highlightAt(all, "JHN.3.16", 4)!.color).toBe("yellow");
  });
  it("links a selection across verses as one group", () => {
    const r = paint([], [{ verseId: "JHN.3.16", start: 30, end: T16.length, verseText: T16 }, { verseId: "JHN.3.17", start: 0, end: 10, verseText: T17 }], "green", { newId });
    expect(r.created).toHaveLength(2);
    expect(r.created[0]!.groupId).toBeTruthy(); expect(r.created[0]!.groupId).toBe(r.created[1]!.groupId);
    expect(groupOf(r.created, r.created[0]!)).toHaveLength(2);
    expect(r.created.every(h => h.text === (h.verseId === "JHN.3.16" ? T16 : T17).slice(h.start, h.end))).toBe(true);
    expect(r.created[1]!.text.startsWith("因为")).toBe(true);
  });
});
