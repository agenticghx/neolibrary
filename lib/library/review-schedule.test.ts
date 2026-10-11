import { describe, expect, it } from "vitest";
import { dayAfter, formatDay, intervals, isDue, isRating, MIN_EASE, schedule, startOfDay, whenLabel, type Rating, type Schedule } from "./review-schedule";

const at = (iso: string) => new Date(iso);
/** Rates a card again and again, each time on the day it comes due (at 09:30 UTC). */
function run(ratings: Rating[], start = at("2026-10-11T09:30:00Z")) {
  let s: Schedule | null = null;
  let now = start;
  const out: Schedule[] = [];
  for (const r of ratings) {
    s = schedule(s, r, now);
    out.push(s);
    now = new Date(s.dueAt.getTime() + 9.5 * 3_600_000);
  }
  return out;
}

describe("Daily review schedule (SM-2 variant)", () => {
  it("counts whole days in UTC", () => {
    expect(startOfDay(at("2026-10-11T23:59:59Z")).toISOString()).toBe("2026-10-11T00:00:00.000Z");
    expect(dayAfter(at("2026-10-11T23:59:59Z"), 3).toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(dayAfter(at("2026-10-31T12:00:00Z"), 1).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("a new card rated Good comes back tomorrow, then in 6 days, then the interval times the ease", () => {
    const s = run(["good", "good", "good", "good"]);
    expect(s.map((x) => x.intervalDays)).toEqual([1, 6, 15, 38]);
    expect(s.map((x) => x.ease)).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(s[0].dueAt.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(s[1].dueAt.toISOString()).toBe("2026-10-18T00:00:00.000Z");
    expect(s.map((x) => x.reps)).toEqual([1, 2, 3, 4]);
  });

  it("intervals keep growing while the card is remembered", () => {
    for (const r of ["hard", "good", "easy"] as const) {
      const s = run(Array(8).fill(r));
      for (let i = 1; i < s.length; i++) expect(s[i].intervalDays, `${r} #${i}`).toBeGreaterThan(s[i - 1].intervalDays);
    }
  });

  it("Easy waits longer than Good, which waits longer than Hard", () => {
    for (const prev of [null, ...run(["good", "good", "good"])]) {
      const n = intervals(prev);
      expect(n.again).toBe(0);
      expect(n.hard).toBeGreaterThanOrEqual(1);
      expect(n.good).toBeGreaterThanOrEqual(n.hard);
      expect(n.easy).toBeGreaterThan(n.good);
    }
  });

  it("only Again keeps a new card due today; Hard, Good and Easy send it at least a day away", () => {
    const now = at("2026-10-11T22:00:00Z");
    expect(isDue(schedule(null, "again", now), now)).toBe(true);
    for (const r of ["hard", "good", "easy"] as const) {
      const s = schedule(null, r, now);
      expect(isDue(s, now), r).toBe(false);
      expect(isDue(s, at("2026-10-11T23:59:59Z")), r).toBe(false);
      expect(isDue(s, at(r === "easy" ? "2026-10-15T00:00:00Z" : "2026-10-12T00:00:00Z")), r).toBe(true);
    }
  });

  it("a lapse (Again on a remembered card) resets the interval and the run, and counts", () => {
    const s = run(["good", "good", "good", "again", "good"]);
    expect(s[3]).toMatchObject({ intervalDays: 0, reps: 0, lapses: 1, ease: 2.3, lastRating: "again" });
    expect(isDue(s[3], s[3].lastReviewedAt)).toBe(true);
    // Learned again from the start: tomorrow.
    expect(s[4]).toMatchObject({ intervalDays: 1, reps: 1, lapses: 1 });
    // Again on a card never remembered is not a lapse.
    expect(schedule(null, "again", at("2026-10-11T09:00:00Z")).lapses).toBe(0);
  });

  it("the ease never falls below 1.3", () => {
    const s = run(Array(12).fill("again"));
    expect(Math.min(...s.map((x) => x.ease))).toBe(MIN_EASE);
    expect(run(Array(12).fill("hard")).at(-1)!.ease).toBe(MIN_EASE);
    expect(run(["easy", "easy"]).map((x) => x.ease)).toEqual([2.65, 2.8]);
  });

  it("keeps when it was first and last rated", () => {
    const [a, b] = run(["good", "hard"]);
    expect(b.firstReviewedAt).toEqual(a.firstReviewedAt);
    expect(b.lastReviewedAt.getTime()).toBeGreaterThan(a.lastReviewedAt.getTime());
    expect(b.lastRating).toBe("hard");
  });

  it("knows the four ratings", () => {
    expect(["again", "hard", "good", "easy"].every(isRating)).toBe(true);
    expect(isRating("perfect")).toBe(false);
  });

  it("says the day and the wait in words", () => {
    expect(formatDay("2026-10-12T00:00:00.000Z")).toBe("Monday, October 12");
    expect([0, 1, 6, 44, 60, 364, 365, 548].map(whenLabel)).toEqual(["today", "tomorrow", "in 6 days", "in 44 days", "in 2 months", "in 12 months", "in 1 year", "in 1.5 years"]);
  });
});
