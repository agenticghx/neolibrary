// The real code takes the steps the models assume (SKILL.md, "Which code each step stands for").
// Each test names the model action it ties to the code. All of them pass on the code as it is;
// one that fails means the code changed under the model: update the model as SKILL.md says.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateCost, generate, reserveSpend, resetSpendHoldsForTests, spending, SpendingCapReached } from "@/lib/ai/generate";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { failedSpend, generations } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { ASK_AGAIN_USD, goAhead, mayPay, paidFor, TURN_OFF } from "@/lib/library/rewritten-turn";
import { fakeProvider, onInsert, rewriteRequest, until } from "./fakes";

let database: Database;
let ownerId: string;
const now = new Date("2026-11-15T12:00:00Z");

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { name: "Ada", email: "ada@example.com", password: "a long enough password" })).id;
});
afterEach(async () => {
  resetSpendHoldsForTests();
  await database.raw.close();
});

describe("SpendCap.tla's steps, in lib/ai/generate.ts", () => {
  it("DecideAndHold: while a paid call is in flight, its estimate is held, so a second call that fits only without it is refused", async () => {
    const ai = fakeProvider();
    const a = rewriteRequest(ownerId);
    const b = rewriteRequest(ownerId, { input: "Another paragraph. ".repeat(21).slice(0, 400) });
    const estimate = estimateCost(ai.model, a);
    const caps = { perBookUsd: 100, perMonthUsd: estimate * 1.5 };
    const first = generate(database.db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "the first call to reach the AI");
    await expect(generate(database.db, ai.model, b, { caps, now: () => now })).rejects.toBeInstanceOf(SpendingCapReached);
    ai.waiting[0].answer();
    await first;
  });

  it("TakeLockAndReadSpending: reserve turns run one at a time (the read of what was spent is inside the lock)", async () => {
    let reading = 0;
    let most = 0;
    const read = async () => {
      reading += 1;
      most = Math.max(most, reading);
      await new Promise((r) => setTimeout(r, 10));
      reading -= 1;
      return { month: 0, book: 0 };
    };
    const caps = { perBookUsd: 100, perMonthUsd: 100 };
    const releases = await Promise.all([1, 2, 3].map(() => reserveSpend(database.db, "anthropic", null, 1, caps, now, "AI", read)));
    expect(most).toBe(1);
    await Promise.all(releases.map((r) => r()));
  });

  it("SaveTheAnswer before ReleaseTheHold: while the answer and its cost are being written, the hold is still in place", async () => {
    const ai = fakeProvider();
    const a = rewriteRequest(ownerId);
    const estimate = estimateCost(ai.model, a);
    const caps = { perBookUsd: 100, perMonthUsd: estimate * 1.5 };
    let checkedDuringSave: unknown = "not run";
    const db = onInsert(database.db, generations, async () => {
      // The insert has not reached the database yet: only the hold can stop this second reserve.
      checkedDuringSave = await reserveSpend(database.db, "anthropic", null, estimate, caps, now, "AI").then(
        () => "passed",
        (e) => e,
      );
    });
    const first = generate(db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "the call to reach the AI");
    ai.waiting[0].answer(ai.atEstimate(a));
    await first;
    expect(checkedDuringSave).toBeInstanceOf(SpendingCapReached);
  });

  it("RecordTheBilledFailure: a billed failure is written to failed_spend with its cost, and counts", async () => {
    const ai = fakeProvider();
    const call = generate(database.db, ai.model, rewriteRequest(ownerId), { now: () => now });
    await until(() => ai.waiting.length === 1, "the call to reach the AI");
    ai.waiting[0].fail(ai.billedFailure());
    await expect(call).rejects.toThrow("cut off");
    const [row] = await database.db.select().from(failedSpend);
    expect(row.costUsd).toBeGreaterThan(0);
    expect((await spending(database.db, "anthropic", null, now)).month).toBeCloseTo(row.costUsd);
  });

  it("ReleaseTheHold runs on every path: after an unbilled failure the whole cap is free again", async () => {
    const ai = fakeProvider();
    const a = rewriteRequest(ownerId);
    const estimate = estimateCost(ai.model, a);
    const caps = { perBookUsd: 100, perMonthUsd: estimate * 1.5 };
    const call = generate(database.db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "the call to reach the AI");
    ai.waiting[0].fail(new Error("529 overloaded"));
    await expect(call).rejects.toThrow("529");
    const release = await reserveSpend(database.db, "anthropic", null, estimate, caps, now, "AI");
    await release();
  });

  it("CheckSameRequestInFlight: two identical requests at the same moment make one paid call", async () => {
    const ai = fakeProvider();
    const a = rewriteRequest(ownerId);
    const both = Promise.all([generate(database.db, ai.model, a, { now: () => now }), generate(database.db, ai.model, a, { now: () => now })]);
    await until(() => ai.waiting.length === 1, "one call to reach the AI");
    ai.waiting[0].answer();
    const [one, two] = await both;
    expect(ai.waiting).toHaveLength(1);
    expect([one.reused, two.reused].sort()).toEqual([false, true]);
  });
});

describe("RewriteAsYouTurn.tla's numbers, in lib/library/rewritten-turn.ts", () => {
  it("MayPay: pays without asking while the total with the next paragraph stays within AskAt (the config's cents), or just after a press", () => {
    const cfg = readFileSync(new URL("../RewriteAsYouTurn.cfg", import.meta.url), "utf8");
    const askAt = Number(/AskAt = (\d+)/.exec(cfg)?.[1]);
    const cost = Number(/Cost = (\d+)/.exec(cfg)?.[1]);
    expect(askAt).toBe(Math.round(ASK_AGAIN_USD * 100));
    expect(mayPay((askAt - cost) / 100, cost / 100, false)).toBe(true);
    expect(mayPay((askAt - cost + 1) / 100, cost / 100, false)).toBe(false);
    expect(mayPay(0, (askAt + 20) / 100, false)).toBe(false);
    expect(mayPay(0, (askAt + 20) / 100, true)).toBe(true);
  });

  it("goAhead turns it on and starts the count again; paidFor adds a paid paragraph to it", () => {
    const on = goAhead(paidFor(paidFor(TURN_OFF, 0.6), 0.6));
    expect(on).toMatchObject({ on: true, sinceOk: 0, count: 2 });
    expect(paidFor(on, 0.25).sinceOk).toBeCloseTo(0.25);
  });
});
