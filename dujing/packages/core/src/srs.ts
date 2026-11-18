// Spaced repetition: a simplified SM-2 (the algorithm behind SuperMemo-2 / Anki).
// Ported unchanged from the original app so review schedules carry over exactly.
//
//   Got it  -> first success 1 day, second 3 days, then interval × ease; ease +0.05
//   Almost  -> interval × 0.5 (min 1 day, max 3 for young words); ease −0.15
//   Forgot  -> again later this session, then due tomorrow; ease −0.20; lapses +1;
//              the word goes on the Review list until Got it twice in a row.
//   A "day" turns over at 4 a.m. local time.
import type { ReviewResult, SrsState, VocabWord } from "./types";

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export const NEW_PER_SESSION = 10;
export const SESSION_SIZE = 20;
export const HISTORY_CAP = 200;

export function freshSrs(): SrsState {
  return { state: "new", interval: 0, ease: 2.5, due: null, reps: 0, lapses: 0, streak: 0, last: null, inReview: false, history: [] };
}
export const srsOf = (w: Pick<VocabWord, "srs">): SrsState => ({ ...freshSrs(), ...(w.srs ?? {}) });

function startOfDay(t: number) { const d = new Date(t); d.setHours(4, 0, 0, 0); return d.getTime(); }

/** Apply one answer. Pure: returns a new state. */
export function answer(srs: SrsState, result: ReviewResult, now = Date.now()): SrsState {
  const s: SrsState = { ...srs, history: [...(srs.history ?? [])] };
  s.reps += 1; s.last = result;
  if (result === "got") {
    s.streak += 1;
    if (s.state !== "review" || s.interval < 1) s.interval = s.streak >= 2 ? 3 : 1;
    else s.interval = Math.max(s.interval + 1, Math.round(s.interval * s.ease));
    s.ease = clamp(s.ease + 0.05, 1.3, 3.0);
    s.state = "review";
    if (s.inReview && s.streak >= 2) s.inReview = false;
  } else if (result === "almost") {
    s.streak = 0;
    s.interval = clamp(Math.round(s.interval * 0.5), 1, s.interval >= 6 ? 365 : 3);
    s.ease = clamp(s.ease - 0.15, 1.3, 3.0);
    s.state = s.state === "new" ? "learning" : s.state;
  } else {
    s.streak = 0; s.lapses += 1;
    s.interval = 0;
    s.ease = clamp(s.ease - 0.2, 1.3, 3.0);
    s.state = "learning";
    s.inReview = true;
  }
  s.due = iso(startOfDay(now) + (s.interval === 0 ? 1 : s.interval) * DAY);
  s.history.push({ at: iso(now), result, interval: s.interval });
  if (s.history.length > HISTORY_CAP) s.history = s.history.slice(-HISTORY_CAP);
  return s;
}

export function isDue(w: Pick<VocabWord, "srs">, now = Date.now()) {
  const s = w.srs; return !!(s && s.reps > 0 && s.due && Date.parse(s.due) <= now);
}

export type Category = "study" | "review" | "strong" | "weak" | "notStudied" | "all";
export function categories(w: Pick<VocabWord, "srs">, now = Date.now()): Set<Category> {
  const s = srsOf(w);
  const c = new Set<Category>(["all"]);
  if (!s.reps) { c.add("notStudied"); c.add("study"); return c; }
  if (isDue(w, now) || s.inReview) c.add("study");
  if (s.inReview) c.add("review");
  const strong = s.streak >= 3 && s.interval >= 7 && !s.inReview;
  if (strong) c.add("strong");
  else if (s.last === "almost" || s.lapses >= 2 || (s.inReview && s.lapses >= 1)) c.add("weak");
  return c;
}

/** Due words first (struggling ones first), then new words in the order they were saved. */
export function buildSession(words: Pick<VocabWord, "id" | "srs" | "addedAt">[], { size = SESSION_SIZE, newLimit = NEW_PER_SESSION, now = Date.now() } = {}) {
  const due = words.filter(w => isDue(w, now) || (w.srs && w.srs.inReview));
  const score = (w: Pick<VocabWord, "srs">) => {
    const s = srsOf(w);
    return (s.inReview ? 1000 : 0) + s.lapses * 50 + (s.last === "almost" ? 30 : 0) + Math.min(30, (now - Date.parse(s.due || iso(now))) / DAY);
  };
  due.sort((a, b) => score(b) - score(a));
  const fresh = words.filter(w => !srsOf(w).reps).sort((a, b) => (a.addedAt || "").localeCompare(b.addedAt || ""));
  const picked = due.slice(0, size);
  const nNew = Math.max(0, Math.min(newLimit, size - picked.length, fresh.length));
  return { cards: [...picked, ...fresh.slice(0, nNew)].map(w => w.id), newIds: fresh.slice(0, nNew).map(w => w.id) };
}

export const CATEGORY_LABEL: Record<Category, string> = { study: "Study", review: "Review", strong: "Strong", weak: "Weak", notStudied: "Not studied", all: "All saved" };
export const CATEGORY_LABEL_ZH: Record<Category, string> = { study: "待复习", review: "需加强", strong: "已掌握", weak: "不熟", notStudied: "未学习", all: "全部" };

export function describeNext(srs: SrsState | undefined, now = Date.now()) {
  if (!srs || !srs.reps) return "Not studied yet";
  if (srs.interval === 0) return "Again soon";
  const d = Math.round((Date.parse(srs.due!) - now) / DAY);
  return d <= 0 ? "Due today" : d === 1 ? "Next review tomorrow" : `Next review in ${d} days`;
}
