// Each finding of SKILL.md, replayed on the real code one model step at a time. Each test PASSES
// WHILE THE BUG IS THERE. When one fails, the code changed: if the bug was fixed on purpose, move
// that finding to "Fixed" in SKILL.md, delete its test, and make its config expect exit 0.
// Findings 2 to 6 were fixed in M44 (holds are rows in the database), and finding 1 for generate (the hold
// is holdCost, the most a call can cost): their tests are now real tests, in lib/ai/spend-holds.test.ts and
// lib/db/postgres.test.ts; finding 7 for one server (the job looks for a saved answer again) in
// lib/ai/spend-holds.test.ts. What is left of findings 1 and 7 is replayed here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { batchCostUsd } from "@/lib/ai/batch";
import { ClaudeModel } from "@/lib/ai/claude";
import { generate, resetSpendHoldsForTests } from "@/lib/ai/generate";
import { costUsd } from "@/lib/ai/model";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { generations } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MAX_PICTURE_TOKENS } from "@/lib/library/page-pictures";
import { MAX_TOKENS, pageEstimateUsd } from "@/lib/library/text-edition";
import { fakeProvider, rewriteRequest, until } from "./fakes";

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


describe("SpendCap findings", () => {
  it("Finding 1, what is left (a) (SpendCap-finding-fallback-not-counted): a refusal rescued by the fallback model is paid twice and recorded once", async () => {
    // The API's answer when Opus 5.5 declined and its fallback answered: usage.iterations lists both attempts
    // (both billed); the top-level usage covers only the attempt that produced the answer (Claude API docs).
    const declined = { type: "message", model: "claude-opus-5-5", input_tokens: 1200, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null };
    const rescue = { type: "fallback_message", model: "claude-opus-5", input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null };
    const body = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" }, trigger: { type: "refusal" } }, { type: "text", text: "An answer." }],
      stop_reason: "end_turn",
      stop_details: null,
      usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, iterations: [declined, rescue] },
    };
    const fetch = (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as typeof globalThis.fetch;
    const out = await new ClaudeModel("not-a-real-key", "claude-opus-5-5", { fetch }).generate({ system: "Answer.", prompt: "A question.", maxTokens: 2000, effort: "low" });
    const recorded = costUsd(out.model, out.inputTokens, out.outputTokens, out.cache);
    const paid = costUsd("claude-opus-5-5", 1200, 500) + costUsd("claude-opus-5", 1200, 300);
    expect(recorded).toBeCloseTo(costUsd("claude-opus-5", 1200, 300));
    expect(recorded).toBeLessThan(paid);
  });

  it("Finding 1, what is left (b) (SpendCap-finding-text-edition-above-estimate): a text-edition page may cost more than the job holds for it", () => {
    // The job holds pageEstimateUsd a page (1,000 output tokens); each page's request allows MAX_TOKENS (8,000).
    const model = "claude-sonnet-5-5";
    expect(MAX_TOKENS).toBeGreaterThan(1000);
    expect(batchCostUsd(model, MAX_PICTURE_TOKENS + 400, MAX_TOKENS)).toBeGreaterThan(pageEstimateUsd(model));
  });

  it("Finding 7, what is left (SpendCap-finding-paid-twice-two-servers): two identical requests on two copies of the server both pay", async () => {
    vi.resetModules();
    const second = await import("@/lib/ai/generate");
    const ai = fakeProvider("claude-opus-5-5");
    const ask = rewriteRequest(ownerId, { kind: "ask", options: {}, promptName: "ask" }); // a kind not shared between readers
    // 1-5. request 1, on the first server: no saved answer, nothing in flight; it holds; the AI is working.
    const one = generate(database.db, ai.model, ask, { now: () => now });
    await until(() => ai.waiting.length === 1, "request 1 to reach the AI");
    // 6-8. request 2, on the second server: no saved answer (twice), nothing in its own in-flight map; it holds and pays.
    const two = second.generate(database.db, ai.model, ask, { now: () => now });
    await until(() => ai.waiting.length === 2, "request 2 to reach the AI");
    ai.waiting[0].answer();
    ai.waiting[1].answer();
    expect([(await one).reused, (await two).reused]).toEqual([false, false]);
    expect(await database.db.select().from(generations)).toHaveLength(2);
    second.resetSpendHoldsForTests();
  });
});
