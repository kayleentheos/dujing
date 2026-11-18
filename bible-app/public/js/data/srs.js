// Spaced repetition: a simplified SM-2 (the algorithm behind SuperMemo-2 /
// Anki), documented here so it can be tuned later.
//
// Each saved word carries `srs`:
//   { state: "new" | "learning" | "review",
//     interval: days until the next review (0 = again in this session),
//     ease: growth factor (starts 2.5, min 1.3, max 3.0),
//     due: ISO date of the next review,
//     reps, lapses, streak (consecutive Got it), last ("forgot"|"almost"|"got"),
//     inReview: true while the word is on the Review list,
//     history: [{ at, result, interval }] }
//
// Answers:
//   Got it  -> first success 1 day, second 3 days, then interval x ease; ease +0.05
//   Almost  -> interval x 0.5 (at least 1 day, at most 3 for young words); ease -0.15
//   Forgot  -> shown again later in the same session, then due tomorrow;
//              ease -0.20; lapses +1; added to the Review list.
//   A word leaves the Review list after Got it twice in a row.
//
// Categories (one word can be in several):
//   study       due now (and has been introduced)
//   review      on the Review list
//   strong      streak >= 3 and interval >= 7 days, not on the Review list
//   weak        last answer Almost, or forgotten 2+ times, and not strong
//   notStudied  never answered
const DAY = 86400000;
const iso = t => new Date(t).toISOString();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const NEW_PER_SESSION = 10;
export const SESSION_SIZE = 20;

export function fresh() {
  return { state: "new", interval: 0, ease: 2.5, due: null, reps: 0, lapses: 0, streak: 0, last: null, inReview: false, history: [] };
}
export const srsOf = rec => ({ ...fresh(), ...(rec.srs || {}) });

/** Apply an answer; returns the new srs object (pure). */
export function answer(srs, result, now = Date.now()) {
  const s = { ...srs, history: [...(srs.history || [])] };
  s.reps += 1; s.last = result;
  if (result === "got") {
    s.streak += 1;
    if (s.state !== "review" || s.interval < 1) s.interval = s.streak >= 2 ? 3 : 1;     // learning steps: 1 day, then 3
    else s.interval = Math.max(s.interval + 1, Math.round(s.interval * s.ease));      // then grow by the ease factor
    s.ease = clamp(s.ease + 0.05, 1.3, 3.0);
    s.state = "review";
    if (s.inReview && s.streak >= 2) s.inReview = false;
  } else if (result === "almost") {
    s.streak = 0;
    s.interval = clamp(Math.round(s.interval * 0.5), 1, s.interval >= 6 ? 365 : 3);
    s.ease = clamp(s.ease - 0.15, 1.3, 3.0);
    s.state = s.state === "new" ? "learning" : s.state;
  } else {                           // forgot
    s.streak = 0; s.lapses += 1;
    s.interval = 0;                  // again in this session; tomorrow afterwards
    s.ease = clamp(s.ease - 0.2, 1.3, 3.0);
    s.state = "learning";
    s.inReview = true;
  }
  const days = s.interval === 0 ? 1 : s.interval;
  s.due = iso(startOfDay(now) + days * DAY);
  s.history.push({ at: iso(now), result, interval: s.interval });
  if (s.history.length > 200) s.history = s.history.slice(-200);
  return s;
}
const startOfDay = t => { const d = new Date(t); d.setHours(4, 0, 0, 0); return d.getTime(); };   // a "day" turns over at 4 a.m.

export function isDue(rec, now = Date.now()) {
  const s = rec.srs; return !!(s && s.reps > 0 && s.due && Date.parse(s.due) <= now);
}
export function categories(rec, now = Date.now()) {
  const s = srsOf(rec);
  const c = new Set(["all"]);
  if (!s.reps) { c.add("notStudied"); c.add("study"); return c; }
  if (isDue(rec, now) || s.inReview) c.add("study");      // "Study" = everything waiting for you now
  if (s.inReview) c.add("review");
  const strong = s.streak >= 3 && s.interval >= 7 && !s.inReview;
  if (strong) c.add("strong");
  else if (s.last === "almost" || s.lapses >= 2 || (s.inReview && s.lapses >= 1)) c.add("weak");
  return c;
}

/** Build a study session: due words first (struggling ones first), then new words. */
export function buildSession(records, { size = SESSION_SIZE, newLimit = NEW_PER_SESSION, now = Date.now() } = {}) {
  const due = records.filter(r => isDue(r, now) || (r.srs && r.srs.inReview));
  const score = r => { const s = srsOf(r); return (s.inReview ? 1000 : 0) + s.lapses * 50 + (s.last === "almost" ? 30 : 0) + Math.min(30, (now - Date.parse(s.due || iso(now))) / DAY); };
  due.sort((a, b) => score(b) - score(a));
  const fresh = records.filter(r => !srsOf(r).reps).sort((a, b) => (a.addedAt || "").localeCompare(b.addedAt || ""));
  const picked = due.slice(0, size);
  const nNew = Math.min(newLimit, size - picked.length, fresh.length);
  return { cards: [...picked, ...fresh.slice(0, Math.max(0, nNew))].map(r => r.id), newIds: fresh.slice(0, Math.max(0, nNew)).map(r => r.id) };
}

export const LABEL = { study: "Study", review: "Review", strong: "Strong", weak: "Weak", notStudied: "Not studied", all: "All saved" };
export const LABEL_ZH = { study: "待复习", review: "需加强", strong: "已掌握", weak: "不熟", notStudied: "未学习", all: "全部" };

export function describeNext(srs, now = Date.now()) {
  if (!srs || !srs.reps) return "Not studied yet";
  if (srs.interval === 0) return "Again soon";
  const d = Math.round((Date.parse(srs.due) - now) / DAY);
  return d <= 0 ? "Due today" : d === 1 ? "Next review tomorrow" : `Next review in ${d} days`;
}
