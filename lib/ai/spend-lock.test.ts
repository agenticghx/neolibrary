import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books, failedSpend, generations } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { HOLD_KIND, heldByCalls, reserveSpend, resetSpendHoldsForTests, spending, SpendingCapReached } from "./generate";

const now = new Date("2026-10-08T00:00:00Z");
const caps = { perBookUsd: 5, perMonthUsd: 1 };
let database: Database;
let ownerId: string;
const holdFor = (bookId: string | null = null) => ({ ownerId, bookId, model: "fake-voice", kind: "speech" });

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { name: "Ada", email: "ada@example.com", password: "a long enough password" })).id;
});
afterEach(async () => {
  resetSpendHoldsForTests();
  await database.raw.close();
});

describe("reserveSpend", () => {
  it("lets two callers that both fit hold at once, and refuses a second that would pass the cap", async () => {
    const both = await Promise.all([0.4, 0.4].map((usd) => reserveSpend(database.db, "voice-overlap", holdFor(), usd, caps, now, "voice")));
    expect((await heldByCalls(database.db, "voice-overlap", null, now)).month).toBeCloseTo(0.8);
    await Promise.all(both.map((h) => h.release()));
    expect(await database.db.select().from(failedSpend)).toEqual([]);

    const tries = await Promise.allSettled([0.6, 0.6].map((usd) => reserveSpend(database.db, "voice-overlap", holdFor(), usd, caps, now, "voice")));
    const refused = tries.filter((r) => r.status === "rejected");
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(SpendingCapReached);
  });

  it("counts a hold against one book as well as the month", async () => {
    const [book] = await database.db.insert(books).values({ ownerId, title: "A book" }).returning();
    await database.db.insert(generations).values({
      ownerId,
      bookId: book.id,
      kind: "rewrite",
      options: {},
      cacheKey: "k",
      provider: "voice-book",
      model: "m",
      promptName: "p",
      promptHash: "h",
      inputHash: "i",
      costUsd: 4.5,
      output: "",
      createdAt: new Date("2026-09-01T00:00:00Z"), // last month: counts for the book only
    });
    const big = { perBookUsd: 5, perMonthUsd: 100 };
    const hold = await reserveSpend(database.db, "voice-book", holdFor(book.id), 0.4, big, now, "voice");
    await expect(reserveSpend(database.db, "voice-book", holdFor(book.id), 0.4, big, now, "voice")).rejects.toThrow("CAP_PER_BOOK");
    await hold.release();
    const again = await reserveSpend(database.db, "voice-book", holdFor(book.id), 0.4, big, now, "voice");
    await again.release();
  });

  it("is a row while it holds, not spending; billed() turns it into the real cost, once", async () => {
    const hold = await reserveSpend(database.db, "voice-rows", holdFor(), 0.5, caps, now, "voice");
    const [row] = await database.db.select().from(failedSpend);
    expect(row).toMatchObject({ ownerId, provider: "voice-rows", kind: HOLD_KIND, costUsd: 0.5 });
    expect(row.reason).toMatch(/^Held while a paid call runs/);
    expect((await spending(database.db, "voice-rows", null, now)).month).toBe(0);
    await hold.billed({ model: "fake-voice", costUsd: 0.2, reason: "Paid, but the audio could not be saved: disk full" });
    await hold.release(); // a no-op: the hold is settled
    const rows = await database.db.select().from(failedSpend);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "speech", costUsd: 0.2, reason: "Paid, but the audio could not be saved: disk full" });
    expect((await spending(database.db, "voice-rows", null, now)).month).toBeCloseTo(0.2);
    expect((await heldByCalls(database.db, "voice-rows", null, now)).month).toBe(0);
  });
});
