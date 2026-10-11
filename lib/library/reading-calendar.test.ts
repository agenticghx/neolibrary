import { describe, expect, it } from "vitest";
import { calendarWeeks, dayKey, heatStep, secondsByDay, streaksFrom } from "./reading-stats";

// M21: the reading calendar's day bucketing and streak maths (the database part is in reading-stats.test.ts).

const MIN = 60;
/** Seconds per day, from "YYYY-MM-DD" → minutes. */
const days = (m: Record<string, number>) => new Map(Object.entries(m).map(([d, min]) => [d, min * MIN]));
/** Sunday 11 October 2026, mid-afternoon UTC. */
const now = new Date("2026-10-11T15:00:00Z");

describe("days are UTC days (M21)", () => {
  it("a sitting counts on the UTC day it started, whatever the offset it was sent with", () => {
    expect(dayKey(new Date("2026-10-11T23:59:59Z"))).toBe("2026-10-11");
    expect(dayKey(new Date("2026-10-12T00:00:00Z"))).toBe("2026-10-12");
    // 00:30 on 29 March in Paris (summer time starts that night) is still 28 March in UTC.
    expect(dayKey(new Date("2026-03-29T00:30:00+02:00"))).toBe("2026-03-28");
    // 9 pm in New York is the next UTC day.
    expect(dayKey(new Date("2026-10-11T21:00:00-04:00"))).toBe("2026-10-12");
  });

  it("adds up the sittings of each day, and a sitting past midnight stays on its first day", () => {
    const byDay = secondsByDay([
      { startedAt: new Date("2026-10-10T08:00:00Z"), activeSeconds: 600 },
      { startedAt: new Date("2026-10-10T23:50:00Z"), activeSeconds: 1800 }, // runs past midnight
      { startedAt: new Date("2026-10-11T00:10:00Z"), activeSeconds: 120 },
    ]);
    expect(Object.fromEntries(byDay)).toEqual({ "2026-10-10": 2400, "2026-10-11": 120 });
  });

  it("shades a day in five steps by whole minutes: none, 1–14, 15–29, 30–59, an hour or more", () => {
    expect([0, 59, 60, 14 * MIN + 59, 15 * MIN, 29 * MIN, 30 * MIN, 59 * MIN + 59, 60 * MIN, 600 * MIN].map(heatStep)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });
});

describe("the calendar's weeks (M21)", () => {
  it("is 26 columns of Monday to Sunday, ending with this week; days after today are empty", () => {
    const weeks = calendarWeeks(days({ "2026-10-07": 23, "2026-04-13": 5, "2026-04-12": 9 }), now);
    expect(weeks).toHaveLength(26);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // The first column starts on Monday 13 April: 25 weeks before Monday 5 October.
    expect(weeks[0][0]).toEqual({ date: "2026-04-13", seconds: 5 * MIN, step: 1, today: false });
    // Sunday 12 April, the day before, is outside the calendar.
    expect(weeks.flat().some((d) => d?.date === "2026-04-12")).toBe(false);
    const last = weeks[25];
    expect(last.map((d) => d?.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(last[2]).toEqual({ date: "2026-10-07", seconds: 23 * MIN, step: 2, today: false });
    expect(last[6]).toMatchObject({ date: "2026-10-11", today: true });
  });

  it("leaves the rest of the week empty when today is not a Sunday", () => {
    const wednesday = new Date("2026-10-07T10:00:00Z");
    const last = calendarWeeks(new Map(), wednesday).at(-1)!;
    expect(last.map((d) => d?.date ?? null)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", null, null, null, null]);
    expect(last[2]?.today).toBe(true);
  });

  it("starts each column on Monday across the end of summer time (UTC has none)", () => {
    const weeks = calendarWeeks(new Map(), new Date("2026-11-02T12:00:00Z"));
    expect(weeks.map((w) => new Date(`${w[0]!.date}T00:00:00Z`).getUTCDay())).toEqual(Array(26).fill(1));
    expect(weeks.flat().filter(Boolean)).toHaveLength(25 * 7 + 1);
  });
});

describe("streaks (M21)", () => {
  it("are all zero, with no best day, before any reading", () => {
    expect(streaksFrom(new Map(), now)).toEqual({ current: 0, longest: 0, best: null, daysRead: 0 });
  });

  it("a single day read today is a streak of one", () => {
    expect(streaksFrom(days({ "2026-10-11": 12 }), now)).toEqual({ current: 1, longest: 1, best: { date: "2026-10-11", seconds: 12 * MIN }, daysRead: 1 });
  });

  it("today not read yet: the streak up to yesterday still counts", () => {
    const s = streaksFrom(days({ "2026-10-08": 5, "2026-10-09": 5, "2026-10-10": 5 }), now);
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
  });

  it("a day missed before yesterday ends the current streak", () => {
    expect(streaksFrom(days({ "2026-10-08": 5, "2026-10-09": 5 }), now).current).toBe(0);
  });

  it("a gap splits runs; the longest run wins, wherever it is", () => {
    const s = streaksFrom(
      days({
        "2026-09-01": 10, "2026-09-02": 10, "2026-09-03": 10, "2026-09-04": 10, // 4 days
        "2026-09-06": 10, // gap on the 5th
        "2026-10-10": 10, "2026-10-11": 10, // current: 2
      }),
      now,
    );
    expect(s).toMatchObject({ current: 2, longest: 4, daysRead: 7 });
  });

  it("under a full minute does not count as a day read, nor break or join a streak", () => {
    const s = streaksFrom(new Map([["2026-10-09", 300], ["2026-10-10", 59], ["2026-10-11", 300]]), now);
    expect(s).toMatchObject({ current: 1, longest: 1, daysRead: 2 });
  });

  it("a long run is counted in full, also past the calendar's 26 weeks", () => {
    const byDay = new Map<string, number>();
    for (let i = 0; i < 400; i++) byDay.set(dayKey(new Date(now.getTime() - i * 86_400_000)), 20 * MIN);
    const s = streaksFrom(byDay, now);
    expect(s.current).toBe(400);
    expect(s.longest).toBe(400);
    // Days read covers only the calendar: 25 full weeks and this week's Monday to Sunday.
    expect(s.daysRead).toBe(26 * 7);
  });

  it("the best day is the most reading in a day, the earliest on a tie", () => {
    const s = streaksFrom(days({ "2026-06-01": 95, "2026-07-01": 40, "2026-08-01": 95 }), now);
    expect(s.best).toEqual({ date: "2026-06-01", seconds: 95 * MIN });
  });
});
