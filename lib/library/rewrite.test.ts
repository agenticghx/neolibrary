import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { generate, SpendingCapReached, spending } from "@/lib/ai/generate";
import { sha256 } from "@/lib/ai/prompts";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { steCheck } from "@/lib/ai/ste";
import { estimateRewrite, listRewrites, paragraphFor, rewriteParagraph, strictnessFrom, viewRewrite } from "./rewrite";
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
    // Plain English follows Samuel's plain-english skill (M17), sent without its header.
    expect(model.calls[0].system).toContain("into plain English");
    expect(model.calls[0].system).toContain("One idea per sentence.");
    expect(model.calls[0].system).not.toContain("name: plain-english");
    expect(model.calls[0].system).not.toContain("{{");

    const prompt = readFileSync("prompts/plain-rewrite.md", "utf8");
    const skill = readFileSync("prompts/plain/SKILL.md", "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    expect(first.generation).toMatchObject({
      kind: "rewrite",
      bookId,
      sectionId: p.id,
      options: { level: "plain" },
      output: expect.stringMatching(/^Fake rewrite \(plain english\): /),
      provenance: {
        provider: "anthropic",
        model: "fake",
        promptName: "plain-rewrite + plain/SKILL",
        promptHash: sha256(`${prompt}\n\n${skill}`),
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
    const req = {
      ownerId,
      bookId,
      sectionId: paragraphs[2].id,
      kind: "rewrite",
      options: { level: "plain" },
      promptName: "plain-rewrite + plain/SKILL",
      promptHash: sha256("prompt, first wording"),
      input: paragraphs[2].text,
      system: "s",
      prompt: `<passage>${paragraphs[2].text}</passage>`,
      maxTokens: 100,
      effort: "low" as const,
    };
    const old = await generate(database.db, model, req);
    const edited = await generate(database.db, model, { ...req, promptHash: sha256("prompt, edited") });
    expect([old.reused, edited.reused]).toEqual([false, false]);
    expect(model.calls).toHaveLength(2);
    expect((await listRewrites(database.db, ownerId, bookId, paragraphs[2].id)).map((g) => g.provenance.promptHash)).toEqual([
      sha256("prompt, first wording"),
      sha256("prompt, edited"),
    ]);
  });

  it("rewrites are private: another reader's identical request is its own call", async () => {
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
    expect((await listRewrites(database.db, ownerId, bookId, p.id)).map((g) => g.id)).toEqual([a.generation.id]);
  });

  it("finds the paragraph at a place in the book (a selection's CFI)", async () => {
    const all = await getSections(database.db, ownerId, bookId);
    const p = all.find((s) => s.id === paragraphs[3].id)!;
    const inside = p.cfi.replace(/\)$/, "/1:10)");
    expect(await paragraphFor(database.db, ownerId, bookId, { cfi: inside })).toEqual({
      id: p.id,
      text: p.text,
      cfi: p.cfi,
      chapter: all.find((s) => s.kind === "chapter" && s.chapterIndex === p.chapterIndex)!.label,
    });
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

describe("STE rewrites (M6)", () => {
  it("send Samuel's STE skill at the chosen strictness, and keep each strictness as its own version", async () => {
    const model = new FakeModel();
    const p = paragraphs[4];
    const std = await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: p.id, level: "ste" });
    expect(std.generation.options).toEqual({ level: "ste", strictness: "standard" });
    const sent = model.calls[0];
    expect(sent.system).toContain("Choose the strictness level first"); // from prompts/ste/SKILL.md
    expect(sent.system).toContain("| in order to | to |"); // from prompts/ste/substitutions.md
    expect(sent.system).toContain("Strictness level: Standard (≈80%)");
    expect(sent.system).not.toContain('name: "simplified-technical-english"'); // the skill's front matter is dropped
    expect(sent.prompt).toContain("Task: Rewrite (STE, Standard (≈80%))");
    const file = readFileSync("prompts/ste-rewrite.md", "utf8");
    const skill = readFileSync("prompts/ste/SKILL.md", "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    const subs = readFileSync("prompts/ste/substitutions.md", "utf8").trim();
    expect(std.generation.provenance.promptHash).toBe(sha256(`${file}\n\n${skill}\n\n${subs}`));

    await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: p.id, level: "ste", strictness: "strict" });
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].system).toContain("Strictness level: Strict (full STE)");
    // 85% is Standard: the stored answer is re-served.
    const again = await rewriteParagraph(database.db, model, ownerId, { bookId, sectionId: p.id, level: "ste", strictness: strictnessFrom("85%")! });
    expect(again.reused).toBe(true);
    expect(model.calls).toHaveLength(2);

    const [first] = await listRewrites(database.db, ownerId, bookId, p.id);
    expect(first.text).toMatch(/^Fake rewrite \(ste, standard \(≈80%\)\): /);
    expect(first.text).not.toContain("---notes---");
    expect(first.meaningChanges).toEqual(["The test AI chose no meanings; this note shows where real ones go."]);
    expect(first.ste).toEqual(expect.objectContaining({ score: steCheck(first.text).compliance }));
  });

  it("splits the notes from the rewrite and scores it with the STE checker", () => {
    const g = { output: "Close the valve. The pump has been running.\n---notes---\n- \"Since\" read as \"because\".\n\n", options: { level: "ste" } };
    const v = viewRewrite(g as never);
    expect(v.text).toBe("Close the valve. The pump has been running.");
    expect(v.meaningChanges).toEqual(['"Since" read as "because".']);
    expect(v.ste).toEqual({ score: 50, errors: 1, warnings: 0, sentences: 2 });
    expect(viewRewrite({ output: "Plain.", options: { level: "plain" } } as never)).toMatchObject({ text: "Plain.", ste: null, meaningChanges: [] });
  });

  it("maps a strictness percentage to a level, as the skill defines", () => {
    expect([95, 90, 89.9, 80, 70, 69, 0].map(strictnessFrom)).toEqual(["strict", "strict", "standard", "standard", "standard", "light", "light"]);
    expect(["light", "standard", "strict", "80%", " 92 % "].map(strictnessFrom)).toEqual(["light", "standard", "strict", "standard", "strict"]);
    expect([101, -1, "loose", "", null, "constructor"].map(strictnessFrom)).toEqual([null, null, null, null, null, null]);
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
