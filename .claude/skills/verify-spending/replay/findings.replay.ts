// Each finding of SKILL.md, replayed on the real code one model step at a time. Each test PASSES
// WHILE THE BUG IS THERE. When one fails, the code changed: if the bug was fixed on purpose, move
// that finding to "Fixed" in SKILL.md, delete its test, and make its config expect exit 0.
// Findings 2 to 6 were fixed in M44 (holds are rows in the database): their tests are now real tests,
// in lib/ai/spend-holds.test.ts and lib/db/postgres.test.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateCost, generate, resetSpendHoldsForTests, spending } from "@/lib/ai/generate";
import { costUsd } from "@/lib/ai/model";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { generations } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { fakeProvider, firstReadArrivesLate, MODEL, rewriteRequest, until } from "./fakes";

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

const spentThisMonth = async () => (await spending(database.db, "anthropic", null, now)).month;

describe("SpendCap findings", () => {
  it("Finding 1 (SpendCap-finding-cost-above-estimate): a call may cost more than its estimate, so the month's cap is passed", async () => {
    const ai = fakeProvider();
    const a = rewriteRequest(ownerId);
    const estimate = estimateCost(ai.model, a);
    // The worst case the call itself allows: all of maxTokens as output. The estimate counts 2 x input + 1000.
    expect(costUsd(MODEL, 200, a.maxTokens, { write: 100, read: 0 })).toBeGreaterThan(estimate);
    const caps = { perBookUsd: 100, perMonthUsd: estimate };
    // 1-4. no saved answer; no identical request; it reads what has been spent ($0); the estimate fits: reserved.
    const call = generate(database.db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "the call to reach the AI");
    // 5. the AI answers with maxTokens of output, and is paid. 6-7. saved; released.
    ai.waiting[0].answer({ inputTokens: 200, outputTokens: a.maxTokens });
    await call;
    expect(await spentThisMonth()).toBeGreaterThan(caps.perMonthUsd);
  });

  it("Finding 7 (SpendCap-finding-paid-twice): two identical requests, and the AI is paid twice for one answer", async () => {
    const ai = fakeProvider("claude-opus-5-5");
    const ask = rewriteRequest(ownerId, { kind: "ask", options: {}, promptName: "ask" }); // a kind not shared between readers
    // 1-5. request 1: no saved answer, nothing in flight; reserved; the AI is working.
    const first = generate(database.db, ai.model, ask, { now: () => now });
    await until(() => ai.waiting.length === 1, "request 1 to reach the AI");
    // 6. request 2 looks for a saved answer (none yet); the answer is slow to come back from the database.
    let arrive = () => {};
    const gate = new Promise<void>((r) => (arrive = r));
    const second = generate(firstReadArrivesLate(database.db, gate), ai.model, ask, { now: () => now });
    await new Promise((r) => setTimeout(r, 20));
    // 7-8. request 1's answer is saved, its hold released, and it leaves the in-flight map.
    ai.waiting[0].answer();
    await first;
    // 9. request 2 hears "no saved answer" and finds nothing in flight. 10-12. it is reserved, and the AI is paid again.
    arrive();
    await until(() => ai.waiting.length === 2, "request 2 to reach the AI");
    ai.waiting[1].answer();
    expect((await second).reused).toBe(false);
    expect(ai.charged).toHaveLength(2);
    expect(await database.db.select().from(generations)).toHaveLength(2);
  });
});
