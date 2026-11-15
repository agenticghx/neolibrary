// Each finding of SKILL.md, replayed on the real code one model step at a time. Each test PASSES
// WHILE THE BUG IS THERE. When one fails, the code changed: if the bug was fixed on purpose, move
// that finding to "Fixed" in SKILL.md, delete its test, and make its config expect exit 0.
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeBatchModel } from "@/lib/ai/batch";
import { estimateCost, generate, resetSpendHoldsForTests, spending, spendingWithJobs } from "@/lib/ai/generate";
import { costUsd } from "@/lib/ai/model";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books, failedSpend, generations } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { importBook } from "@/lib/library/import";
import { forgetTextEditionsForTests, startTextEdition, textEditionSummary } from "@/lib/library/text-edition";
import { MemoryStorage } from "@/lib/storage";
import { fakeProvider, firstReadArrivesLate, MODEL, onInsert, rewriteRequest, until } from "./fakes";

let database: Database;
let ownerId: string;
const now = new Date("2026-11-15T12:00:00Z");

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { name: "Ada", email: "ada@example.com", password: "a long enough password" })).id;
});
afterEach(async () => {
  forgetTextEditionsForTests();
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

  it("Finding 2 (SpendCap-finding-book-group): a call on the scan and one on its text edition both pass the one per-book cap", async () => {
    const [scan] = await database.db.insert(books).values({ ownerId, title: "A scanned book" }).returning();
    const [edition] = await database.db.insert(books).values({ ownerId, title: "Its text edition", editionOf: scan.id }).returning();
    const ai = fakeProvider();
    const a = rewriteRequest(ownerId, { bookId: scan.id });
    const b = rewriteRequest(ownerId, { bookId: edition.id, input: "Another paragraph. ".repeat(21).slice(0, 400) });
    const estimate = estimateCost(ai.model, a);
    const caps = { perBookUsd: estimate * 1.5, perMonthUsd: 100 };
    // 1-5. request 1 (the scan) is reserved and the AI is paid; its cost is not written yet.
    const first = generate(database.db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "request 1 to reach the AI");
    // 6-9. request 3 (the edition) reads the book group's spending ($0) and only its own bookId's hold ($0): it fits.
    const second = generate(database.db, ai.model, b, { caps, now: () => now });
    await until(() => ai.waiting.length === 2, "request 3 to reach the AI");
    // 10. both are paid.
    ai.waiting[0].answer(ai.atEstimate(a));
    ai.waiting[1].answer(ai.atEstimate(b));
    await Promise.all([first, second]);
    expect((await spending(database.db, "anthropic", edition.id, now)).book).toBeGreaterThan(caps.perBookUsd);
  });

  it("Finding 3 (SpendCap-finding-text-edition-start): a text edition starts beside a paid call in flight, and the book's cap is passed", async () => {
    const storage = new MemoryStorage();
    const doc = await PDFDocument.load(readFileSync(new URL("../../../../fixtures/books/scanned-meditation.pdf", import.meta.url)));
    const { bookId } = await importBook(database.db, storage, ownerId, { name: "scanned-meditation.pdf", bytes: await doc.save() });
    const batch = new FakeBatchModel({ answer: (r) => `Text of ${r.id}.` });
    const pages = (await textEditionSummary({ db: database.db, storage, model: batch, caps: { perBookUsd: 1000, perMonthUsd: 1000 } }, ownerId, bookId)).estimateUsd;
    const ai = fakeProvider();
    const a = rewriteRequest(ownerId, { bookId });
    const estimate = estimateCost(ai.model, a);
    // Room for the text edition, or for the call, not for both.
    const caps = { perBookUsd: pages + estimate / 2, perMonthUsd: 1000 };
    // 1-5. a paid call on the book is reserved and in flight.
    const call = generate(database.db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "the call to reach the AI");
    // 6. the text edition reads what has been spent: the database only, not the hold. 7. it fits: its job is saved.
    const deps = { db: database.db, storage, model: batch, caps, now: () => now };
    expect((await textEditionSummary(deps, ownerId, bookId)).overLimit).toBeNull();
    const started = await startTextEdition(deps, ownerId, bookId, true);
    expect(started.started).toBe(true);
    await started.done;
    // 8. the call is paid; with the job's hold, what is spent and held on the book is past its cap.
    ai.waiting[0].answer(ai.atEstimate(a));
    await call;
    expect((await spendingWithJobs(database.db, "anthropic", bookId, now)).book).toBeGreaterThan(caps.perBookUsd);
  });

  it("Finding 4 (SpendCap-finding-save-fails): the AI is paid, saving the answer fails, and the cost is never written", async () => {
    const ai = fakeProvider();
    const db = onInsert(database.db, generations, () => {
      throw new Error("the database is not reachable");
    });
    // 1-5. reserved, the AI answers and is paid. 6. saving fails. 7. the hold is released.
    const call = generate(db, ai.model, rewriteRequest(ownerId), { now: () => now });
    await until(() => ai.waiting.length === 1, "the call to reach the AI");
    ai.waiting[0].answer();
    await expect(call).rejects.toThrow("not reachable");
    expect(ai.total()).toBeGreaterThan(0);
    expect(await database.db.select().from(failedSpend)).toEqual([]);
    expect(await spentThisMonth()).toBe(0);
  });

  it("Finding 5 (SpendCap-finding-restart): the server restarts during a paid call; the next call fits the whole cap again", async () => {
    const ai = fakeProvider();
    const a = rewriteRequest(ownerId);
    const b = rewriteRequest(ownerId, { input: "Another paragraph. ".repeat(21).slice(0, 400) });
    const estimate = estimateCost(ai.model, a);
    const caps = { perBookUsd: 100, perMonthUsd: estimate * 1.5 };
    // 1-5. request 1 is reserved and the AI is working on it.
    void generate(database.db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "request 1 to reach the AI");
    // 6. the server restarts: its memory (the holds) is gone, and request 1's code never runs again.
    //    The AI finishes the request it was sent, and charges for it.
    resetSpendHoldsForTests();
    ai.charge(estimate);
    // 7-11. request 2, in the new server: it reads $0 spent and no hold, so it fits; the AI is paid.
    const second = generate(database.db, ai.model, b, { caps, now: () => now });
    await until(() => ai.waiting.length === 2, "request 2 to reach the AI");
    ai.waiting[1].answer(ai.atEstimate(b));
    await second;
    expect(ai.total()).toBeGreaterThan(caps.perMonthUsd);
    expect(await spentThisMonth()).toBeLessThan(ai.total());
  });

  it("Finding 6 (SpendCap-finding-two-servers): two copies of the server each pass the month's cap that only one call fits", async () => {
    vi.resetModules();
    const one = await import("@/lib/ai/generate");
    vi.resetModules();
    const two = await import("@/lib/ai/generate");
    expect(one.generate).not.toBe(two.generate);
    const ai = fakeProvider();
    const a = rewriteRequest(ownerId);
    const b = rewriteRequest(ownerId, { input: "Another paragraph. ".repeat(21).slice(0, 400) });
    const estimate = estimateCost(ai.model, a);
    const caps = { perBookUsd: 100, perMonthUsd: estimate * 1.5 };
    const first = one.generate(database.db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "request 1 to reach the AI");
    const second = two.generate(database.db, ai.model, b, { caps, now: () => now });
    await until(() => ai.waiting.length === 2, "request 3 to reach the AI");
    ai.waiting[0].answer(ai.atEstimate(a));
    ai.waiting[1].answer(ai.atEstimate(b));
    await Promise.all([first, second]);
    expect(await spentThisMonth()).toBeGreaterThan(caps.perMonthUsd);
    one.resetSpendHoldsForTests();
    two.resetSpendHoldsForTests();
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
