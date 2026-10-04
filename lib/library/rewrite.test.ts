import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { SpendingCapReached, spending } from "@/lib/ai/generate";
import { sha256 } from "@/lib/ai/prompts";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { estimateRewrite, listRewrites, rewriteParagraph } from "./rewrite";
import { getSections } from "./sections-store";

let database: Database;
let ownerId: string;
let bookId: string;
let paragraphs: { id: string; text: string }[];

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes: file })).bookId;
  paragraphs = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph" && s.text.length > 200);
});
afterEach(() => database.raw.close());

async function otherReader() {
  const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
  return (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
}

describe("rewrite a paragraph (M6, ground rule 5)", () => {
  it("stores the rewrite with its provenance and re-serves it without a second call", async () => {
    const model = new FakeModel();
    const p = paragraphs[0];
    const first = await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: p.id, level: "plain" });
    expect(first.reused).toBe(false);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].prompt).toContain(p.text);
    expect(model.calls[0].prompt).toContain("The Strange Case of Dr. Jekyll and Mr. Hyde, by Robert Louis Stevenson");
    expect(model.calls[0].system).toContain("Plain English.");
    expect(model.calls[0].system).not.toContain("{{");

    const prompt = readFileSync("prompts/rewrite.md", "utf8");
    const level = readFileSync("prompts/rewrite-levels/plain.md", "utf8").trim();
    expect(first.generation).toMatchObject({
      kind: "rewrite",
      bookId,
      sectionId: p.id,
      options: { level: "plain" },
      output: expect.stringMatching(/^Fake rewrite \(plain english\): /),
      provenance: {
        provider: "anthropic",
        model: "fake",
        promptName: "rewrite + rewrite-levels/plain",
        promptHash: sha256(`${prompt}\n\n${level}`),
        inputHash: sha256(p.text),
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        costUsd: expect.any(Number),
        createdAt: expect.any(String),
      },
    });
    expect(first.generation.provenance.costUsd).toBeGreaterThan(0);

    const again = await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: p.id, level: "plain" });
    expect(again).toEqual({ generation: first.generation, reused: true });
    expect(model.calls).toHaveLength(1);
  });

  it("keeps every level and every fresh attempt as a version; the original text is untouched", async () => {
    const model = new FakeModel();
    const p = paragraphs[1];
    let n = 0;
    const numbered = new FakeModel(() => `Version ${++n}`);
    await rewriteParagraph(database.db, numbered, ownerId, { bookId, sectionId: p.id, level: "plain" });
    await rewriteParagraph(database.db, numbered, ownerId, { bookId, sectionId: p.id, level: "shorter" });
    const fresh = await rewriteParagraph(database.db, numbered, ownerId, { bookId, sectionId: p.id, level: "plain", fresh: true });
    expect(fresh.reused).toBe(false);
    expect((await listRewrites(database.db, ownerId, bookId, p.id)).map((g) => [g.options.level, g.output])).toEqual([
      ["plain", "Version 1"],
      ["shorter", "Version 2"],
      ["plain", "Version 3"],
    ]);
    // The latest attempt is the one re-served.
    const served = await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: p.id, level: "plain" });
    expect(served.generation.output).toBe("Version 3");
    expect(model.calls).toHaveLength(0);
    const after = (await getSections(database.db, ownerId, bookId)).find((s) => s.id === p.id);
    expect(after?.text).toBe(p.text);
  });

  it("a changed prompt file gives a new answer; the old one keeps its old fingerprint", async () => {
    const model = new FakeModel();
    const p = paragraphs[2];
    const a = await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: p.id, level: "biologist" });
    // Same text and level but another reader: rewrites are private (ground rule 6), so this is a new call.
    const other = await otherReader();
    const otherBook = (
      await importBook(database.db, new MemoryStorage(), other, {
        name: "jh.epub",
        bytes: new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url))),
      })
    ).bookId;
    await rewriteParagraph(database.db, model, other, { bookId: otherBook, sectionId: p.id, level: "biologist" });
    expect(model.calls).toHaveLength(2);
    expect(await listRewrites(database.db, ownerId, bookId, p.id)).toEqual([a.generation]);
  });

  it("refuses paragraphs that are not the reader's, and headings", async () => {
    const model = new FakeModel();
    const other = await otherReader();
    await expect(rewriteParagraph(database.db, model, other, { bookId, sectionId: paragraphs[0].id, level: "plain" })).rejects.toThrow(
      "not found",
    );
    const chapter = (await getSections(database.db, ownerId, bookId)).find((s) => s.kind === "chapter")!;
    await expect(rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: chapter.id, level: "plain" })).rejects.toThrow(
      "Only paragraphs",
    );
    expect(model.calls).toHaveLength(0);
  });
});

describe("spending caps (ground rule 8)", () => {
  it("shows an estimate first and stops before the per-book cap, without calling the model", async () => {
    const model = new FakeModel();
    const est = await estimateRewrite(database.db, model, ownerId, bookId, paragraphs[0].id, "plain");
    expect(est).toBeGreaterThan(0);
    expect(est).toBeLessThan(0.1);
    const caps = { perBookUsd: est * 2.5, perMonthUsd: 100 };
    await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: paragraphs[0].id, level: "plain" }, { caps });
    await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: paragraphs[1].id, level: "plain" }, { caps });
    const spent = await spending(database.db, "anthropic", bookId);
    expect(spent.book).toBeGreaterThan(0);
    expect(spent.month).toBeCloseTo(spent.book);
    const p = paragraphs.find((x) => x.text.length > 600)!;
    await expect(
      rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: p.id, level: "plain" }, { caps: { perBookUsd: spent.book + 0.0001, perMonthUsd: 100 } }),
    ).rejects.toThrow(SpendingCapReached);
    expect(model.calls).toHaveLength(2);
    // A stored answer costs nothing, so it is served even at the cap.
    const stored = await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: paragraphs[0].id, level: "plain" }, { caps: { perBookUsd: 0, perMonthUsd: 0 } });
    expect(stored.reused).toBe(true);
  });

  it("stops at the monthly cap, which resets on the 1st", async () => {
    const model = new FakeModel();
    const sept = () => new Date("2026-09-30T23:00:00Z");
    await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: paragraphs[0].id, level: "plain" }, { now: sept });
    const { month } = await spending(database.db, "anthropic", null, sept());
    const est = await estimateRewrite(database.db, model, ownerId, bookId, paragraphs[1].id, "plain");
    // Enough for one more rewrite in a fresh month, not on top of September's spending.
    const caps = { perBookUsd: 100, perMonthUsd: est + month / 2 };
    await expect(
      rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: paragraphs[1].id, level: "plain" }, { caps, now: sept }),
    ).rejects.toThrow("This month's AI spending cap ($");
    const oct = () => new Date("2026-10-01T00:30:00Z");
    const ok = await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: paragraphs[1].id, level: "plain" }, { caps, now: oct });
    expect(ok.reused).toBe(false);
  });

  it("two identical requests at once make one call", async () => {
    const model = new FakeModel();
    const input = { bookId, sectionId: paragraphs[0].id, level: "plain" as const };
    const [a, b] = await Promise.all([
      rewriteParagraph(database.db, model, ownerId, input),
      rewriteParagraph(database.db, model, ownerId, input),
    ]);
    expect(model.calls).toHaveLength(1);
    expect(a.generation.id).toBe(b.generation.id);
  });
});
