import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database, Db } from "@/lib/db/client";
import { audioTracks, books, failedSpend, generations } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { speakPassage } from "@/lib/library/audio";
import { costReport } from "@/lib/library/costs";
import { importBook } from "@/lib/library/import";
import { makePicture } from "@/lib/library/pictures";
import { getSections } from "@/lib/library/sections-store";
import { forgetTextEditionsForTests, startTextEdition, textEditionSummary } from "@/lib/library/text-edition";
import { FakeImageGenerator, imageUsd } from "@/lib/images/generate";
import { FakeSpeech } from "@/lib/speech/fake";
import { MemoryStorage } from "@/lib/storage";
import { FakeBatchModel } from "./batch";
import { estimateCost, generate, HOLD_KIND, heldByCalls, resetSpendHoldsForTests, spending, SpendingCapReached, type GenerationRequest } from "./generate";
import { costUsd, type TextModel, type TextResult } from "./model";

// M44: a call's hold (the reservation of its estimate) is a row in the database, written under a Postgres
// advisory lock. These tests are the findings of the verify-spending check (SKILL.md, findings 2 to 6), on
// the real code: each failed while the holds lived in one server's memory.

const MODEL = "claude-sonnet-5-5";
const now = new Date("2026-11-15T12:00:00Z");
let database: Database;
let ownerId: string;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { name: "Ada", email: "ada@example.com", password: "a long enough password" })).id;
});
afterEach(async () => {
  forgetTextEditionsForTests();
  resetSpendHoldsForTests();
  await database.raw.close();
});

/** A provider whose calls wait until the test answers them; it charges when it answers, as a real one does. */
function waitingProvider() {
  const waiting: { answer: (over?: Partial<TextResult>) => void }[] = [];
  const model: TextModel = {
    provider: "anthropic",
    model: MODEL,
    generate: () =>
      new Promise<TextResult>((resolve) => {
        waiting.push({ answer: (over = {}) => resolve({ text: "A rewrite.", model: MODEL, inputTokens: 200, outputTokens: 100, cache: { write: 0, read: 0 }, ...over }) });
      }),
  };
  return { model, waiting };
}

/**
 * A second call that should be refused: it either throws, or (the bug) reaches the AI. Returns what it threw,
 * or fails at once when it reached the AI, so the old code fails here and not by a timeout.
 */
async function refused(call: Promise<unknown>, ai: ReturnType<typeof waitingProvider>, before: number) {
  let result: unknown = undefined;
  let settled = false;
  call.then(
    () => ((settled = true), (result = "answered")),
    (e) => ((settled = true), (result = e)),
  );
  await until(() => settled || ai.waiting.length > before, "the second call to be refused or reach the AI");
  expect(ai.waiting, "the second call reached the AI: it was not refused").toHaveLength(before);
  return result;
}

async function until(ready: () => boolean, what: string) {
  for (let i = 0; i < 2000; i++) {
    if (ready()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const request = (over: Partial<GenerationRequest> = {}): GenerationRequest => {
  const input = (over.input ?? "The paragraph to rewrite. ".repeat(16)).slice(0, 400);
  return {
    ownerId,
    bookId: null,
    sectionId: null,
    kind: "rewrite",
    options: { level: "plain" },
    promptName: "rewrite",
    promptHash: "test",
    system: "Rewrite the paragraph in plain English. ".repeat(10).slice(0, 400),
    prompt: input,
    maxTokens: 4000,
    effort: "low",
    ...over,
    input,
  };
};

/** The database, with every insert into `table` made to throw. */
function insertsFail(db: Db, table: object): Db {
  return new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key === "insert") return (t: object, ...rest: unknown[]) => (t === table ? { values: () => ({ returning: () => Promise.reject(new Error("the database is not reachable")) }) } : (value as (...a: unknown[]) => unknown).call(target, t, ...rest));
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Db;
}

describe("holds seen everywhere (findings 2, 3, 5, 6)", () => {
  it("finding 2: a call on a scan's text edition sees the hold of a call on the scan (one per-book cap)", async () => {
    const [scan] = await database.db.insert(books).values({ ownerId, title: "A scanned book" }).returning();
    const [edition] = await database.db.insert(books).values({ ownerId, title: "Its text edition", editionOf: scan.id }).returning();
    const ai = waitingProvider();
    const a = request({ bookId: scan.id });
    const caps = { perBookUsd: estimateCost(ai.model, a) * 1.5, perMonthUsd: 100 };
    const first = generate(database.db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "the call on the scan to reach the AI");
    const second = generate(database.db, ai.model, request({ bookId: edition.id, input: "Another paragraph. ".repeat(21) }), { caps, now: () => now });
    expect(String(await refused(second, ai, 1))).toContain("This book's AI spending cap");
    ai.waiting[0].answer();
    await first;
  });

  it("finding 3: a text edition is not started beside a paid call in flight that leaves it no room", async () => {
    const storage = new MemoryStorage();
    const doc = await PDFDocument.load(readFileSync(new URL("../../fixtures/books/scanned-meditation.pdf", import.meta.url)));
    const { bookId } = await importBook(database.db, storage, ownerId, { name: "scanned-meditation.pdf", bytes: await doc.save() });
    const batch = new FakeBatchModel({ answer: (r) => `Text of ${r.id}.` });
    const pages = (await textEditionSummary({ db: database.db, storage, model: batch, caps: { perBookUsd: 1000, perMonthUsd: 1000 } }, ownerId, bookId)).estimateUsd;
    const ai = waitingProvider();
    const a = request({ bookId });
    const caps = { perBookUsd: pages + estimateCost(ai.model, a) / 2, perMonthUsd: 1000 };
    const call = generate(database.db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "the call to reach the AI");
    const deps = { db: database.db, storage, model: batch, caps, now: () => now };
    expect((await textEditionSummary(deps, ownerId, bookId)).overLimit).toMatch(/more than this book's AI limit allows/);
    await expect(startTextEdition(deps, ownerId, bookId, true)).rejects.toMatchObject({ status: 402 });
    ai.waiting[0].answer();
    await call;
  });

  it("finding 5: after a restart mid-call, the call's hold still counts, and the costs page shows it", async () => {
    const ai = waitingProvider();
    const a = request();
    const estimate = estimateCost(ai.model, a);
    const caps = { perBookUsd: 100, perMonthUsd: estimate * 1.5 };
    void generate(database.db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "request 1 to reach the AI");
    // The server restarts: its memory is gone and request 1's code never runs again (the AI may still bill it).
    resetSpendHoldsForTests();
    const second = generate(database.db, ai.model, request({ input: "Another paragraph. ".repeat(21) }), { caps, now: () => now });
    expect(await refused(second, ai, 1)).toBeInstanceOf(SpendingCapReached);
    expect((await heldByCalls(database.db, "anthropic", null, now)).month).toBeCloseTo(estimate);
    const claude = (await costReport(database.db, ownerId, now)).services.find((s) => s.provider === "anthropic")!;
    expect(claude.spentUsd).toBe(0);
    expect(claude.heldUsd).toBeCloseTo(estimate);
  });

  it("finding 6: two copies of the server see each other's holds", async () => {
    vi.resetModules();
    const two = await import("@/lib/ai/generate");
    const ai = waitingProvider();
    const a = request();
    const caps = { perBookUsd: 100, perMonthUsd: estimateCost(ai.model, a) * 1.5 };
    const first = generate(database.db, ai.model, a, { caps, now: () => now });
    await until(() => ai.waiting.length === 1, "request 1 to reach the AI");
    const second = two.generate(database.db, ai.model, request({ input: "Another paragraph. ".repeat(21) }), { caps, now: () => now });
    expect(String(await refused(second, ai, 1))).toContain("This month's AI spending cap");
    ai.waiting[0].answer();
    await first;
    two.resetSpendHoldsForTests();
  });
});

describe("a paid result that cannot be saved still counts (finding 4)", () => {
  it("generate: the hold becomes a failed_spend row of the answer's real cost", async () => {
    const ai = waitingProvider();
    const call = generate(insertsFail(database.db, generations), ai.model, request(), { now: () => now });
    await until(() => ai.waiting.length === 1, "the call to reach the AI");
    ai.waiting[0].answer();
    await expect(call).rejects.toThrow("not reachable");
    const paid = costUsd(MODEL, 200, 100, { write: 0, read: 0 });
    const rows = await database.db.select().from(failedSpend);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "rewrite", model: MODEL, inputTokens: 200, outputTokens: 100 });
    expect(rows[0].costUsd).toBeCloseTo(paid);
    expect(rows[0].reason).toBe("Paid, but the answer could not be saved: the database is not reachable");
    expect((await spending(database.db, "anthropic", null, now)).month).toBeCloseTo(paid);
  });

  it("speak: the voice's cost is written when the track cannot be saved", async () => {
    const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
    const { bookId } = await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes: file });
    const [p] = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
    const voice = new FakeSpeech();
    await expect(speakPassage(insertsFail(database.db, audioTracks), new MemoryStorage(), voice, ownerId, { bookId, sectionId: p.id, voice: "fake-ada" }, { now: () => now })).rejects.toThrow(
      "not reachable",
    );
    const [row] = await database.db.select().from(failedSpend);
    expect(row).toMatchObject({ kind: "speech", provider: "elevenlabs", bookId });
    expect(row.costUsd).toBeGreaterThan(0);
    expect(row.reason).toMatch(/^Paid, but the audio could not be saved/);
  });

  it("makePicture: the picture's cost is written when it cannot be saved", async () => {
    const [book] = await database.db.insert(books).values({ ownerId, title: "A book" }).returning();
    await expect(makePicture(insertsFail(database.db, generations), new MemoryStorage(), new FakeImageGenerator(), ownerId, { bookId: book.id, subject: "a lighthouse" }, { now: () => now })).rejects.toThrow(
      "not reachable",
    );
    const [row] = await database.db.select().from(failedSpend);
    expect(row).toMatchObject({ kind: "image", bookId: book.id });
    expect(row.costUsd).toBeCloseTo(imageUsd());
  });

  it("a hold settled normally leaves no row", async () => {
    const ai = waitingProvider();
    const call = generate(database.db, ai.model, request(), { now: () => now });
    await until(() => ai.waiting.length === 1, "the call to reach the AI");
    expect((await database.db.select().from(failedSpend)).map((r) => r.kind)).toEqual([HOLD_KIND]);
    ai.waiting[0].answer();
    await call;
    expect(await database.db.select().from(failedSpend)).toEqual([]);
  });
});
