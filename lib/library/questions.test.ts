import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { setStyle } from "./ai-style";
import { importBook } from "./import";
import { listQuestionBanks, markQuestion, marksFor, needsReread, questionBank, SCHEMA, viewQuestions } from "./questions";
import { getSections } from "./sections-store";

let database: Database;
let ownerId: string;
let bookId: string;
let all: Awaited<ReturnType<typeof getSections>>;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes: file })).bookId;
  all = await getSections(database.db, ownerId, bookId);
});
afterEach(() => database.raw.close());

const chapter = (label: string) => all.find((s) => s.kind === "chapter" && s.label === label)!;

/**
 * Waits for the clock to move on by two milliseconds. The test database (PGlite) stamps a mark's `created_at` with
 * `now()` in whole milliseconds (measured 2026-10-07: 40 statements in 5 ms gave 6 distinct values), so two marks of
 * one question made within the same millisecond tie, and `marksFor` then orders them by their random id: the test
 * below failed 1 run in 20. Real Postgres keeps microseconds; two taps on one question cannot share one.
 */
async function laterMillisecond() {
  const t = Date.now();
  while (Date.now() - t < 2) await new Promise((r) => setTimeout(r, 1));
}

describe("question bank (M6)", () => {
  it("asks once per chapter for recall, understanding and application questions, and re-serves them", async () => {
    // In plain English: new readers start in STE light since M17.
    await setStyle(database.db, ownerId, bookId, { scope: "all", style: "plain" });
    const model = new FakeModel();
    const c = chapter("The Carew Murder Case");
    const first = await questionBank(database.db, model, ownerId, { bookId, chapterId: c.id });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].schema).toEqual(SCHEMA);
    expect(model.calls[0].prompt).toContain("Task: Question bank");
    expect(model.calls[0].prompt).toContain("Chapter: The Carew Murder Case");
    expect(model.calls[0].system).toContain("recall:");
    expect(first.generation).toMatchObject({ kind: "questions", sectionId: c.id, style: "plain", ste: null, provenance: { promptName: "questions" } });
    expect(first.generation.questions.map((q) => q.type)).toEqual([
      ...Array(3).fill("recall"),
      ...Array(3).fill("understanding"),
      ...Array(3).fill("application"),
    ]);
    expect(first.generation.questions.map((q) => q.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    const again = await questionBank(database.db, model, ownerId, { bookId, chapterId: c.id });
    expect(again.reused).toBe(true);
    expect(model.calls).toHaveLength(1);

    // In STE, a separate bank with the STE badge.
    await setStyle(database.db, ownerId, bookId, { scope: "all", style: "ste-standard" });
    const ste = await questionBank(database.db, model, ownerId, { bookId, chapterId: c.id });
    expect(ste.generation.style).toBe("ste-standard");
    expect(ste.generation.ste?.score).toEqual(expect.any(Number));
    expect(model.calls[1].system).toContain("Standard (≈80%)");
    expect(await listQuestionBanks(database.db, ownerId, bookId, c.id)).toHaveLength(2);
  });

  it("keeps every mark, counts the latest, and lists chapters that need a re-read", async () => {
    const model = new FakeModel();
    const carew = chapter("The Carew Murder Case");
    const door = chapter("Story of the Door");
    const a = (await questionBank(database.db, model, ownerId, { bookId, chapterId: carew.id })).generation;
    const b = (await questionBank(database.db, model, ownerId, { bookId, chapterId: door.id })).generation;
    expect(await needsReread(database.db, ownerId, bookId)).toEqual([]);

    await markQuestion(database.db, ownerId, { generationId: a.id, index: 0, correct: true });
    await markQuestion(database.db, ownerId, { generationId: a.id, index: 1, correct: false });
    await markQuestion(database.db, ownerId, { generationId: b.id, index: 4, correct: false });
    await laterMillisecond();
    await markQuestion(database.db, ownerId, { generationId: b.id, index: 4, correct: true }); // re-read, got it right
    expect(await marksFor(database.db, ownerId, bookId)).toEqual({ [`${a.id}:0`]: true, [`${a.id}:1`]: false, [`${b.id}:4`]: true });

    expect(await needsReread(database.db, ownerId, bookId)).toEqual([
      {
        id: carew.id,
        label: "The Carew Murder Case",
        cfi: all.find((s) => s.kind === "paragraph" && s.chapterIndex === carew.chapterIndex)!.cfi,
        wrong: 1,
        marked: 2,
      },
    ]);
    const rows = await database.raw.query<{ n: number }>("SELECT count(*)::int AS n FROM question_marks");
    expect(rows[0].n).toBe(4); // nothing overwritten
  });

  it("refuses marks on questions that are not the reader's or do not exist", async () => {
    const model = new FakeModel();
    const g = (await questionBank(database.db, model, ownerId, { bookId, chapterId: chapter("The Carew Murder Case").id })).generation;
    await expect(markQuestion(database.db, ownerId, { generationId: g.id, index: 99, correct: true })).rejects.toThrow("not found");
    await expect(markQuestion(database.db, ownerId, { generationId: g.id, index: 0, correct: "yes" })).rejects.toThrow("right or wrong");
    await expect(markQuestion(database.db, ownerId, { generationId: "nope", index: 0, correct: true })).rejects.toThrow("not found");
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const other = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    await expect(markQuestion(database.db, other, { generationId: g.id, index: 0, correct: true })).rejects.toThrow("not found");
  });

  it("shows nothing rather than garbage for a bad stored answer, keeps positions, and caps the list", () => {
    const q = (output: string) => viewQuestions({ output, options: {} } as never).questions;
    expect(q("nope")).toEqual([]);
    expect(
      q('{"questions":[{"type":"recall","question":"","answer":"x"},{"type":"odd","question":"Why?","answer":"Because."}]}'),
    ).toEqual([{ index: 1, type: "recall", question: "Why?", answer: "Because." }]);
    const many = JSON.stringify({ questions: Array.from({ length: 20 }, () => ({ type: "recall", question: "Q?", answer: "A." })) });
    expect(q(many)).toHaveLength(15);
  });
});
