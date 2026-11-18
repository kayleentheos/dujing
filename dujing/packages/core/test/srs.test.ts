// Same scenarios as the original app's tests/srs.test.mjs, plus parity with the original JS.
import { describe, expect, it } from "vitest";
import * as S from "../src/srs";
// @ts-ignore — the original implementation, for parity
import * as Orig from "../../../../bible-app/public/js/data/srs.js";

const DAY = 86_400_000;
describe("spaced repetition", () => {
  it("follows the learning steps and grows by ease", () => {
    let t = Date.parse("2026-11-17T15:00:00Z");
    let s = S.answer(S.freshSrs(), "got", t);
    expect(s.interval).toBe(1); expect(s.state).toBe("review");
    s = S.answer(s, "got", (t += DAY)); expect(s.interval).toBe(3);
    s = S.answer(s, "got", (t += 3 * DAY)); expect(s.interval).toBeGreaterThanOrEqual(7);
    expect(S.categories({ srs: s }, t).has("strong")).toBe(true);
    const before = s.interval;
    s = S.answer(s, "almost", (t += s.interval * DAY));
    expect(s.interval).toBeLessThan(before);
    expect(S.categories({ srs: s }, t).has("weak")).toBe(true);
    s = S.answer(s, "forgot", (t += DAY));
    expect(s.interval).toBe(0); expect(s.inReview).toBe(true); expect(s.lapses).toBe(1);
    expect(Date.parse(s.due!) - t).toBeLessThan(1.5 * DAY);
    s = S.answer(s, "got", (t += 60_000)); expect(s.inReview).toBe(true);
    s = S.answer(s, "got", (t += DAY)); expect(s.inReview).toBe(false);
    expect(s.history).toHaveLength(7);
  });
  it("builds sessions: struggling first, then due, then at most 10 new", () => {
    const words: any[] = [];
    for (let i = 0; i < 30; i++) words.push({ id: "new" + i, addedAt: "2026-11-0" + (1 + (i % 9)) });
    words.push({ id: "due1", srs: { ...S.freshSrs(), reps: 2, due: "2026-11-16T10:00:00Z", interval: 3 } });
    words.push({ id: "struggle", srs: { ...S.freshSrs(), reps: 5, due: "2026-11-17T10:00:00Z", interval: 1, lapses: 3, inReview: true } });
    words.push({ id: "later", srs: { ...S.freshSrs(), reps: 3, due: "2026-12-30T10:00:00Z", interval: 30 } });
    const sess = S.buildSession(words, { now: Date.parse("2026-11-17T16:00:00Z") });
    expect(sess.cards.slice(0, 2)).toEqual(["struggle", "due1"]);
    expect(sess.cards).toHaveLength(12); expect(sess.newIds).toHaveLength(10); expect(sess.cards).not.toContain("later");
  });
  it("gives exactly the same schedules as the original app (1,000 random answer sequences)", () => {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const results = ["got", "almost", "forgot"] as const;
    for (let n = 0; n < 1000; n++) {
      let a = S.freshSrs(), b = Orig.fresh(), t = Date.parse("2026-01-01T12:00:00Z");
      for (let k = 0; k < 12; k++) {
        const r = results[Math.floor(rnd() * 3)]!; t += Math.floor(rnd() * 20) * DAY + 3600_000;
        a = S.answer(a, r, t); b = Orig.answer(b, r, t);
      }
      expect(a).toEqual(b);
      expect([...S.categories({ srs: a }, t)].sort()).toEqual([...Orig.categories({ srs: b }, t)].sort());
    }
  });
});
