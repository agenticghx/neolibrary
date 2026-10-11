import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { resetSpendHoldsForTests, SpendingCapReached } from "@/lib/ai/generate";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import {
  askBook,
  AskError,
  AskNotFound,
  buildAskRequest,
  cleanQuestion,
  cut,
  estimateAsk,
  findPassages,
  latestAsk,
  MAX_PASSAGE_CHARS,
  MAX_PASSAGES,
  orQuery,
  parseCitations,
  passagesBlock,
  questionTerms,
} from "./ask";
import { importBook } from "./import";

describe("the question's words (M21)", () => {
  it("drops stop words and the question's scaffolding, keeps the meaningful words once, in order", () => {
    expect(questionTerms("What does the author say about Mr. Hyde's rugged countenance? Hyde!")).toEqual(["mr", "hyde", "rugged", "countenance"]);
    expect(questionTerms("Why was the child trampled at the corner in 1886?")).toEqual(["child", "trampled", "corner", "1886"]);
    expect(questionTerms("Qu'est-ce que l'éther?")).toEqual(["qu", "est", "ce", "que", "éther"]);
    expect(questionTerms("What is it about?")).toEqual([]);
    expect(questionTerms("")).toEqual([]);
  });

  it("joins them with OR, never AND, and keeps at most twelve", () => {
    expect(orQuery(["rugged", "countenance"])).toBe("rugged or countenance");
    const many = questionTerms("alpha beta gamma delta epsilon zeta theta iota kappa lambda omicron sigma omega");
    expect(many).toHaveLength(12);
    expect(orQuery(many).split(" or ")).toHaveLength(12);
  });

  it("tidies the question and refuses an empty one", () => {
    expect(cleanQuestion("  Who is\n Utterson?  ")).toBe("Who is Utterson?");
    expect(cleanQuestion("x".repeat(400))).toHaveLength(300);
    expect(() => cleanQuestion("   ")).toThrow(AskError);
    expect(() => cleanQuestion(42)).toThrow(AskError);
  });

  it("cuts long text at a word, with an ellipsis", () => {
    expect(cut("short", 10)).toBe("short");
    expect(cut("one two three four five", 12)).toBe("one two…");
  });
});

describe("citations (M21)", () => {
  it("turns [1], [2][3] and [1, 3] into citations, in paragraphs, listing each passage cited once", () => {
    const { paragraphs, cited } = parseCitations("Hyde is cruel [2][3]. He tramples a child [1, 3].\n\nUtterson is a lawyer [1].", [1, 2, 3]);
    expect(paragraphs).toEqual([
      [{ text: "Hyde is cruel " }, { cite: 2 }, { cite: 3 }, { text: ". He tramples a child " }, { cite: 1 }, { cite: 3 }, { text: "." }],
      [{ text: "Utterson is a lawyer " }, { cite: 1 }, { text: "." }],
    ]);
    expect(cited).toEqual([2, 3, 1]);
  });

  it("never makes a citation of a passage that does not exist: the number stays as plain text", () => {
    const { paragraphs, cited } = parseCitations("True [9]. Also [0] and [2, 7].", [1, 2]);
    expect(paragraphs).toEqual([[{ text: "True [9]. Also [0] and " }, { cite: 2 }, { text: "[7]." }]]);
    expect(cited).toEqual([2]);
    expect(parseCitations("Nothing here [1].", []).cited).toEqual([]);
  });

  it("leaves an answer with no citations as plain text", () => {
    expect(parseCitations("The passages found in this book do not answer this.", [1, 2])).toEqual({
      paragraphs: [[{ text: "The passages found in this book do not answer this." }]],
      cited: [],
    });
  });
});

describe("the request to the model (M21)", () => {
  const passages = [
    { n: 1, sectionId: "p1", cfi: "epubcfi(/6/4!/4/2)", chapter: "Story of the Door", text: "Mr. Utterson the lawyer was a man of a rugged countenance." },
    { n: 2, sectionId: "p9", cfi: "epubcfi(/6/6!/4/8)", chapter: "", text: "He was austere with himself." },
  ];

  it("numbers the passages with their chapters, says to answer only from them, and stores the question", async () => {
    expect(passagesBlock(passages)).toBe(
      '<passage n="1" chapter="Story of the Door">\nMr. Utterson the lawyer was a man of a rugged countenance.\n</passage>\n\n<passage n="2">\nHe was austere with himself.\n</passage>',
    );
    const req = await buildAskRequest("owner", "book", "Jekyll, by Stevenson", "What was Utterson like?", passages);
    expect(req).toMatchObject({ kind: "ask", bookId: "book", sectionId: null, promptName: "ask", effort: "low", maxTokens: 2000 });
    expect(req.schema).toBeUndefined();
    expect(req.options).toEqual({ question: "What was Utterson like?", passages: "p1 p9" });
    expect(req.system).toMatch(/Answer only from those passages/);
    expect(req.system).toContain("[1]");
    expect(req.system).toContain("The passages found in this book do not answer this.");
    expect(req.prompt).toContain("Task: Ask this book\nBook: Jekyll, by Stevenson\nQuestion: What was Utterson like?");
    expect(req.prompt).toContain('<passage n="2">');
    expect(req.prompt).not.toContain("{{");
    expect(req.input).toContain("What was Utterson like?");
    expect(req.input).toContain("rugged countenance");
  });

  it("the test AI cites passage 1, or says the book does not answer when it has no passages", async () => {
    const model = new FakeModel();
    const req = await buildAskRequest("owner", "book", "Jekyll", "What was Utterson like?", passages);
    const { text } = await model.generate(req);
    expect(text).toBe("The test AI's answer, from the passages: the book says “Mr. Utterson the lawyer was a man of a rugged countenance.…” [1]");
    const none = await model.generate(await buildAskRequest("owner", "book", "Jekyll", "Anything?", []));
    expect(none.text).toMatch(/^The passages found in this book do not answer this\./);
  });
});

describe("asking a book, in the database (M21)", () => {
  let database: Database;
  let ownerId: string;
  let jekyll: string;
  let wells: string;
  const fixture = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url))) });

  beforeEach(async () => {
    database = await testDatabase();
    ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
    const storage = new MemoryStorage();
    jekyll = (await importBook(database.db, storage, ownerId, fixture("stevenson-jekyll-and-hyde.epub"))).bookId;
    wells = (await importBook(database.db, storage, ownerId, fixture("wells-the-time-machine.epub"))).bookId;
  });
  afterEach(async () => {
    resetSpendHoldsForTests();
    await database.raw.close();
  });

  it("finds paragraphs with any of the words, best first, from this book only, numbered in reading order", async () => {
    const found = await findPassages(database.db, ownerId, jekyll, "What was his rugged countenance like?");
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(MAX_PASSAGES);
    expect(found.map((p) => p.n)).toEqual(found.map((_, i) => i + 1));
    expect(found.some((p) => p.text.includes("rugged countenance") && p.chapter === "Story of the Door")).toBe(true);
    for (const p of found) {
      expect(p.cfi).toMatch(/^epubcfi\(/);
      expect(p.text.length).toBeLessThanOrEqual(MAX_PASSAGE_CHARS);
    }
    // OR, not AND: a paragraph with only one of the words still counts, so a question with an extra word not in the
    // book still finds the paragraph.
    const loose = await findPassages(database.db, ownerId, jekyll, "rugged countenance spaceship");
    expect(loose.some((p) => p.text.includes("rugged countenance"))).toBe(true);
    // This book only: the Eloi and the Morlocks are in the other one.
    expect(await findPassages(database.db, ownerId, jekyll, "Eloi Morlocks")).toEqual([]);
    expect((await findPassages(database.db, ownerId, wells, "Eloi Morlocks")).length).toBe(MAX_PASSAGES);
    expect(await findPassages(database.db, ownerId, jekyll, "what is it about?")).toEqual([]);
  });

  it("answers from the passages with provenance, re-serves the same question free, and shows it again later", async () => {
    const model = new FakeModel();
    const first = await askBook(database.db, model, ownerId, { bookId: jekyll, question: "What was his rugged countenance like?" });
    if (!first.found) throw new Error("expected passages");
    expect(first.reused).toBe(false);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].prompt).toContain("Book: The Strange Case of Dr. Jekyll and Mr. Hyde");
    expect(first.answer.question).toBe("What was his rugged countenance like?");
    expect(first.answer.cited).toEqual([1]);
    expect(first.answer.paragraphs[0].at(-1)).toEqual({ cite: 1 });
    expect(first.answer.passages[0]).toMatchObject({ n: 1, chapter: expect.any(String), cfi: expect.stringMatching(/^epubcfi\(/) });
    expect(first.answer.passages[0].excerpt.length).toBeLessThanOrEqual(160);
    expect(first.answer.provenance).toMatchObject({ provider: "anthropic", model: "fake", promptName: "ask" });
    expect(first.answer.provenance.costUsd).toBeGreaterThan(0);

    const again = await askBook(database.db, model, ownerId, { bookId: jekyll, question: "  What was his rugged   countenance like? " });
    expect(again).toMatchObject({ found: true, reused: true });
    expect(model.calls).toHaveLength(1);

    const latest = await latestAsk(database.db, ownerId, jekyll);
    expect(latest).toEqual(first.answer);
    expect(await latestAsk(database.db, ownerId, wells)).toBeNull();
  });

  it("spends nothing when no paragraph has any of the words", async () => {
    const model = new FakeModel();
    expect(await askBook(database.db, model, ownerId, { bookId: jekyll, question: "What about the Eloi and the Morlocks?" })).toEqual({
      found: false,
      terms: ["eloi", "morlocks"],
    });
    expect(model.calls).toHaveLength(0);
    await expect(askBook(database.db, model, ownerId, { bookId: jekyll, question: " " })).rejects.toThrow(AskError);
  });

  it("stops at the spending cap, before calling the model", async () => {
    const model = new FakeModel();
    await expect(
      askBook(database.db, model, ownerId, { bookId: jekyll, question: "rugged countenance" }, { caps: { perBookUsd: 0.001, perMonthUsd: 20 } }),
    ).rejects.toThrow(SpendingCapReached);
    expect(model.calls).toHaveLength(0);
  });

  it("is for the book's owner only", async () => {
    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    const model = new FakeModel();
    await expect(askBook(database.db, model, other.id, { bookId: jekyll, question: "rugged countenance" })).rejects.toThrow(AskNotFound);
    expect(await findPassages(database.db, other.id, jekyll, "rugged countenance")).toEqual([]);
    expect(model.calls).toHaveLength(0);
  });

  it("shows the most a question can cost before it is asked", async () => {
    const estimate = await estimateAsk(database.db, new FakeModel(), jekyll);
    // About 3,500 tokens in and 2,000 out at the fake's prices ($4 and $20 per million).
    expect(estimate).toBeGreaterThan(0.04);
    expect(estimate).toBeLessThan(0.07);
  });
});
