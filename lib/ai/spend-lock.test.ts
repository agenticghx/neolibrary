import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { reserveSpend, resetSpendHoldsForTests, SpendingCapReached } from "./generate";

const db = {} as Db;
const now = new Date("2026-10-08T00:00:00Z");
const caps = { perBookUsd: 5, perMonthUsd: 1 };

afterEach(() => resetSpendHoldsForTests());

describe("reserveSpend", () => {
  it("lets two callers that both fit overlap, and refuses a second that would pass the cap", async () => {
    let month = 0;
    const read = async () => ({ month, book: 0 });
    let inFlight = 0;
    let max = 0;
    const pay = async (estimate: number) => {
      const release = await reserveSpend(db, "voice-overlap", null, estimate, caps, now, "voice", read);
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      month += estimate;
      await release();
    };
    await Promise.all([pay(0.4), pay(0.4)]);
    expect(max).toBe(2);
    expect(month).toBeCloseTo(0.8);

    max = 0;
    month = 0;
    const both = await Promise.allSettled([pay(0.6), pay(0.6)]);
    const refused = both.filter((r) => r.status === "rejected");
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(SpendingCapReached);
    expect(max).toBe(1);
    expect(month).toBeCloseTo(0.6);
  });

  it("counts a reserve against one book as well as the month", async () => {
    const read = async () => ({ month: 0, book: 4.5 });
    const book = "00000000-0000-4000-8000-000000000002";
    const release = await reserveSpend(db, "voice-book", book, 0.4, caps, now, "voice", read);
    await expect(reserveSpend(db, "voice-book", book, 0.4, caps, now, "voice", read)).rejects.toThrow("CAP_PER_BOOK");
    await release();
    const again = await reserveSpend(db, "voice-book", book, 0.4, caps, now, "voice", read);
    await again();
  });
});
