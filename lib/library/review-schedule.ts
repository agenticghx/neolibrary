/**
 * Daily review's schedule (M21): spaced repetition, so each card comes back
 * after a growing interval, timed to just before it would be forgotten.
 *
 * A simple variant of SM-2 (Piotr Wozniak's SuperMemo 2 algorithm, the one
 * Anki grew from). Each card has an *ease* (how fast its interval grows,
 * starting at 2.5 and never below 1.3) and an interval in days.
 * - Again: forgotten. The interval resets to 0 (the card comes back today),
 *   the run of successes starts over, and the ease drops by 0.2. A card that
 *   had been remembered before counts one lapse.
 * - Hard: remembered with effort. A short step (1 day the first time, then
 *   about 1.2 times the last interval) and the ease drops by 0.15.
 * - Good: 1 day the first time, 6 days the second, then the last interval
 *   times the ease.
 * - Easy: a longer step (4 days the first time, then about 1.3 times Good's)
 *   and the ease rises by 0.15.
 *
 * Days are whole days in UTC: a card due in 3 days is due from midnight UTC
 * three days after the day it was rated. Pure functions: `now` is passed in,
 * so tests choose the clock.
 */
export const RATINGS = ["again", "hard", "good", "easy"] as const;
export type Rating = (typeof RATINGS)[number];

export const isRating = (r: unknown): r is Rating => (RATINGS as readonly unknown[]).includes(r);

export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
/** No interval past this (about 100 years): the date stays a real date. */
export const MAX_INTERVAL = 36_500;

const DAY_MS = 86_400_000;

export type Schedule = {
  ease: number;
  intervalDays: number;
  /** Successful reviews in a row (Hard, Good or Easy since the last Again). */
  reps: number;
  /** Times a remembered card was forgotten (rated Again). */
  lapses: number;
  dueAt: Date;
  firstReviewedAt: Date;
  lastReviewedAt: Date;
  lastRating: Rating;
};

/** Midnight UTC at the start of `now`'s day. */
export function startOfDay(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
}

/** Midnight UTC `days` whole days after the start of `now`'s day. */
export function dayAfter(now: Date, days: number): Date {
  return new Date(startOfDay(now).getTime() + days * DAY_MS);
}

const roundEase = (e: number) => Math.max(MIN_EASE, Math.round(e * 100) / 100);

/** The next interval, in days, for each rating of a card (null: a new card). */
export function intervals(prev: Pick<Schedule, "ease" | "intervalDays" | "reps"> | null): Record<Rating, number> {
  const ease = prev?.ease ?? START_EASE;
  const last = prev?.intervalDays ?? 0;
  const reps = prev?.reps ?? 0;
  const cap = (n: number) => Math.min(MAX_INTERVAL, Math.max(0, Math.round(n)));
  if (reps === 0) return { again: 0, hard: 1, good: 1, easy: 4 };
  const hard = cap(Math.max(last + 1, last * 1.2));
  const good = cap(Math.max(hard + 1, reps === 1 ? 6 : last * ease));
  const easy = cap(Math.max(good + 1, good * 1.3));
  return { again: 0, hard, good, easy };
}

/** A card's schedule after it is rated at `now` (`prev` null: its first rating). */
export function schedule(prev: Schedule | null, rating: Rating, now: Date): Schedule {
  const ease = prev?.ease ?? START_EASE;
  const reps = prev?.reps ?? 0;
  const intervalDays = intervals(prev)[rating];
  const change = { again: -0.2, hard: -0.15, good: 0, easy: 0.15 }[rating];
  return {
    ease: roundEase(ease + change),
    intervalDays,
    reps: rating === "again" ? 0 : reps + 1,
    lapses: (prev?.lapses ?? 0) + (rating === "again" && reps > 0 ? 1 : 0),
    dueAt: dayAfter(now, intervalDays),
    firstReviewedAt: prev?.firstReviewedAt ?? now,
    lastReviewedAt: now,
    lastRating: rating,
  };
}

/** Due at `now`: its day has come. */
export const isDue = (s: Pick<Schedule, "dueAt">, now: Date) => s.dueAt.getTime() <= now.getTime();

/** A card's day in words, the same on the server and in the browser (fixed language and UTC): "Monday, October 12". */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

/** When a card comes back after a rating, in words: "today", "tomorrow", "in 6 days", "in 2 months", "in 1.5 years". */
export function whenLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 45) return `in ${days} days`;
  if (days < 365) return `in ${Math.round(days / 30)} months`;
  const years = Math.round((days / 365) * 10) / 10;
  return `in ${years} ${years === 1 ? "year" : "years"}`;
}
