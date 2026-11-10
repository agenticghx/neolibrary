import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { failedSpend, generations } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { costReport } from "@/lib/library/costs";
import { generate, resetSpendHoldsForTests, spending, SpendingCapReached, type GenerationRequest } from "./generate";
import { AiError, costUsd, type TextModel } from "./model";

// A paid call that was billed but gave nothing usable (declined, cut off, empty) used to store nothing, so it
// never counted against the spending cap. It is now written to failed_spend and counted (migration 0040).
let database: Database;
let ownerId: string;
const MODEL = "claude-opus-5-5";
const now = new Date("2026-11-10T12:00:00Z");

/** A model that answers like a real one whose answer was cut off: it charges, and gives nothing. */
const cutOff: TextModel = {
  provider: "anthropic",
  model: MODEL,
  generate: async () => {
    throw Object.assign(new AiError("The answer was cut off before it finished."), {
      billed: { model: MODEL, inputTokens: 100_000, outputTokens: 20_000, cache: { write: 0, read: 0 } },
    });
  },
};
const request = (input: string): GenerationRequest => ({
  ownerId,
  bookId: null,
  sectionId: null,
  kind: "rewrite",
  options: {},
  promptName: "rewrite",
  promptHash: "hash",
  input,
  system: "system",
  prompt: input,
  maxTokens: 1000,
  effort: "low",
});

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { name: "Ada", email: "ada@example.com", password: "a long enough password" })).id;
});
afterEach(async () => {
  resetSpendHoldsForTests();
  await database.raw.close();
});

describe("a billed call that gave nothing usable", () => {
  it("is recorded with its cost, is never stored as an answer, and counts against the month's cap", async () => {
    const one = costUsd(MODEL, 100_000, 20_000, { write: 0, read: 0 });
    expect(one).toBeGreaterThan(0);
    const caps = { perBookUsd: 100, perMonthUsd: one * 1.5 };
    await expect(generate(database.db, cutOff, request("first"), { caps, now: () => now })).rejects.toThrow("cut off");
    expect(await database.db.select().from(generations)).toEqual([]);
    const rows = await database.db.select().from(failedSpend);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ownerId, provider: "anthropic", model: MODEL, kind: "rewrite", reason: "The answer was cut off before it finished." });
    expect(rows[0].costUsd).toBeCloseTo(one);
    expect((await spending(database.db, "anthropic", null, now)).month).toBeCloseTo(one);
    // The admin's costs page shows it as money spent.
    const report = await costReport(database.db, ownerId, now, {});
    expect(report.services.find((s) => s.provider === "anthropic")?.spentUsd).toBeCloseTo(one);

    // A second failure fits under the cap's estimate check only if the first was counted; after it the cap is passed.
    await expect(generate(database.db, cutOff, request("second"), { caps, now: () => now })).rejects.toThrow("cut off");
    await expect(generate(database.db, cutOff, request("third"), { caps, now: () => now })).rejects.toThrow(SpendingCapReached);
    expect(await database.db.select().from(failedSpend)).toHaveLength(2);
  });

  it("records nothing when the service did not answer at all", async () => {
    const down: TextModel = { provider: "anthropic", model: MODEL, generate: async () => Promise.reject(new AiError("Claude could not answer (529).")) };
    await expect(generate(database.db, down, request("x"), { now: () => now })).rejects.toThrow("529");
    expect(await database.db.select().from(failedSpend)).toEqual([]);
  });
});
