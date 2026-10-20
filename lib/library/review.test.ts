import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { generations } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, deleteAnnotation, restoreAnnotation, updateAnnotation } from "./annotations";
import { importBook } from "./import";
import { removeBook, restoreBook } from "./remove-book";
import { explainBack, listAttempts, partPassages } from "./explain-back";
import { chapterFor } from "./prerequisites";
import { questionBank } from "./questions";
import { dueCount, gapCardId, questionCardId, questionDelayDays, rateCard, reviewQueue, ReviewError, type ReviewCard } from "./review";
import { getSections } from "./sections-store";

let database: Database;
let ownerId: string;
let bookId: string;
let paras: { id: string; cfi: string; text: string }[];

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const bytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "j.epub", bytes })).bookId;
  paras = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
});
afterEach(() => database.raw.close());

const rangeIn = (p: { cfi: string }, from: number, to: number) => p.cfi.replace(/\)$/, `,/1:${from},/1:${to})`);
const at = (iso: string) => new Date(iso);
const DAY0 = at("2026-10-11T09:00:00Z");

/** A highlight on paragraph `i`, made at `when`, with an optional note. */
const highlight = (i: number, when: Date, body = "") =>
  createAnnotation(database.db, ownerId, { kind: "highlight", bookId, cfi: rangeIn(paras[i], 0, 12), quote: { exact: paras[i].text.slice(0, 12) }, body }, when);

describe("Daily review cards", () => {
  it("highlights and notes on passages, and notes on the whole book, are cards; bookmarks and removed notes are not", async () => {
    const h = await highlight(40, at("2026-10-01T10:00:00Z"), "Utterson is the lawyer");
    const n = await createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "The whole book is about a double life" }, at("2026-10-02T10:00:00Z"));
    await createAnnotation(database.db, ownerId, { kind: "bookmark", bookId, cfi: paras[41].cfi }, at("2026-10-03T10:00:00Z"));
    const gone = await highlight(42, at("2026-10-04T10:00:00Z"));
    await deleteAnnotation(database.db, ownerId, gone.id);

    const q = await reviewQueue(database.db, ownerId, DAY0);
    expect(q.cards.map((c) => c.id)).toEqual([h.id, n.id]);
    expect(q.total).toBe(2);
    expect(q.cards[0]).toMatchObject({
      kind: "highlight",
      on: "passage",
      bookId,
      bookTitle: expect.stringMatching(/^The Strange Case/),
      cfi: rangeIn(paras[40], 0, 12),
      quote: paras[40].text.slice(0, 12),
      note: "Utterson is the lawyer",
      isNew: true,
      dueAt: null,
      next: { again: 0, hard: 1, good: 1, easy: 4 },
    });
    expect(q.cards[0].chapter).not.toBe("");
    expect(q.cards[1]).toMatchObject({ kind: "note", on: "book", cfi: null, quote: "", note: "The whole book is about a double life" });

    // A removed note brought back is a card again; its latest words are shown.
    await restoreAnnotation(database.db, ownerId, gone.id);
    await updateAnnotation(database.db, ownerId, h.id, { body: "Utterson, the lawyer" });
    const again = await reviewQueue(database.db, ownerId, DAY0);
    expect(again.cards.map((c) => c.id)).toEqual([h.id, n.id, gone.id]);
    expect(again.cards[0].note).toBe("Utterson, the lawyer");
  });

  it("a book removed from the library takes its cards with it, and brings them back with it", async () => {
    await highlight(40, at("2026-10-01T10:00:00Z"));
    await removeBook(database.db, ownerId, bookId);
    expect(await reviewQueue(database.db, ownerId, DAY0)).toEqual({ cards: [], nextDueAt: null, total: 0 });
    await restoreBook(database.db, ownerId, bookId);
    expect((await reviewQueue(database.db, ownerId, DAY0)).cards).toHaveLength(1);
  });

  it("a rated card leaves today's queue until its day comes; Again keeps it today", async () => {
    const a = await highlight(40, at("2026-10-01T10:00:00Z"));
    const b = await highlight(41, at("2026-10-02T10:00:00Z"));
    expect(await dueCount(database.db, ownerId, DAY0)).toBe(2);

    const s = await rateCard(database.db, ownerId, a.id, "good", DAY0);
    expect(s).toMatchObject({ intervalDays: 1, reps: 1, dueAt: at("2026-10-12T00:00:00Z") });
    await rateCard(database.db, ownerId, b.id, "again", DAY0);
    let q = await reviewQueue(database.db, ownerId, DAY0);
    expect(q.cards.map((c) => [c.id, c.isNew])).toEqual([[b.id, false]]);
    expect(q.nextDueAt).toBe("2026-10-12T00:00:00.000Z");

    await rateCard(database.db, ownerId, b.id, "easy", at("2026-10-11T09:05:00Z"));
    q = await reviewQueue(database.db, ownerId, at("2026-10-11T09:06:00Z"));
    expect(q).toEqual({ cards: [], nextDueAt: "2026-10-12T00:00:00.000Z", total: 2 });

    // The next day, the Good card is back; the Easy one waits.
    q = await reviewQueue(database.db, ownerId, at("2026-10-12T08:00:00Z"));
    expect(q.cards.map((c) => [c.id, c.isNew, c.next.good])).toEqual([[a.id, false, 6]]);
    await rateCard(database.db, ownerId, a.id, "good", at("2026-10-12T08:00:00Z"));
    expect((await reviewQueue(database.db, ownerId, at("2026-10-12T08:01:00Z"))).nextDueAt).toBe("2026-10-15T00:00:00.000Z");
  });

  it("introduces at most 20 new cards a day, oldest first, after the cards due", async () => {
    const made = [];
    for (let i = 0; i < 23; i++) made.push(await highlight(40 + i, new Date(at("2026-10-01T00:00:00Z").getTime() + i * 60_000)));
    let q = await reviewQueue(database.db, ownerId, DAY0);
    expect(q.cards.map((c) => c.id)).toEqual(made.slice(0, 20).map((m) => m.id));
    expect(q.nextDueAt).toBe("2026-10-12T00:00:00.000Z"); // the three held back
    for (const m of made.slice(0, 5)) await rateCard(database.db, ownerId, m.id, "good", DAY0);
    q = await reviewQueue(database.db, ownerId, DAY0);
    // Five introduced today: fifteen more new ones, not twenty.
    expect(q.cards.map((c) => c.id)).toEqual(made.slice(5, 20).map((m) => m.id));
    // The next day: the five due first, then the next new ones.
    q = await reviewQueue(database.db, ownerId, at("2026-10-12T09:00:00Z"));
    expect(q.cards.slice(0, 5).map((c) => c.isNew)).toEqual([false, false, false, false, false]);
    expect(q.cards.slice(5).map((c) => c.id)).toEqual(made.slice(5, 23).map((m) => m.id));
  });

  it("refuses another reader's card, a removed note, a bookmark and an unknown rating", async () => {
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const otherId = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    const a = await highlight(40, DAY0);
    const mark = await createAnnotation(database.db, ownerId, { kind: "bookmark", bookId, cfi: paras[41].cfi });
    await expect(rateCard(database.db, otherId, a.id, "good", DAY0)).rejects.toThrow(ReviewError);
    await expect(rateCard(database.db, ownerId, a.id, "perfect", DAY0)).rejects.toThrow("Rate it Again, Hard, Good or Easy.");
    await expect(rateCard(database.db, ownerId, "not-an-id", "good", DAY0)).rejects.toThrow("Card not found.");
    await expect(rateCard(database.db, ownerId, mark.id, "good", DAY0)).rejects.toThrow("Card not found.");
    await deleteAnnotation(database.db, ownerId, a.id);
    await expect(rateCard(database.db, ownerId, a.id, "good", DAY0)).rejects.toThrow("Card not found.");
    expect(await dueCount(database.db, otherId, DAY0)).toBe(0);
  });
});

describe("Test yourself questions as cards (M28 S1)", () => {
  /** A question bank for the chapter of paragraph `i`, stored as made at `when`. */
  async function bank(i: number, when: Date, fresh = false) {
    const all = await getSections(database.db, ownerId, bookId);
    const chapter = all.find((s) => s.kind === "chapter" && s.chapterIndex === all.find((p) => p.id === paras[i].id)!.chapterIndex)!;
    const out = await questionBank(database.db, new FakeModel(), ownerId, { bookId, chapterId: chapter.id, fresh });
    await database.db.update(generations).set({ createdAt: when }).where(eq(generations.id, out.generation.id));
    return { id: out.generation.id, chapter, questions: out.generation.questions };
  }

  it("every question of a bank is a card from the day after the bank was made, the question first and the answer behind it", async () => {
    const b = await bank(40, at("2026-10-11T08:00:00Z"));
    expect(b.questions).toHaveLength(9);
    // The same day: no question yet; the next card is the next day.
    let q = await reviewQueue(database.db, ownerId, DAY0);
    expect(q).toEqual({ cards: [], nextDueAt: "2026-10-12T00:00:00.000Z", total: 9 });
    expect(await dueCount(database.db, ownerId, at("2026-10-11T23:59:00Z"))).toBe(0);
    // The next day: one card per question, in the bank's order.
    q = await reviewQueue(database.db, ownerId, at("2026-10-12T00:00:00Z"));
    expect(q.cards.map((c) => c.id)).toEqual(b.questions.map((x) => questionCardId(b.id, x.index)));
    const first = await getSections(database.db, ownerId, bookId).then((all) => all.find((s) => s.kind === "paragraph" && s.chapterIndex === b.chapter.chapterIndex)!);
    expect(q.cards[0]).toEqual({
      id: `q:${b.id}:0`,
      kind: "question",
      on: "chapter",
      bookId,
      bookTitle: expect.stringMatching(/^The Strange Case/),
      bookAuthor: expect.any(String),
      chapter: b.chapter.label,
      cfi: first.cfi,
      quote: "",
      note: "",
      question: b.questions[0].question,
      answer: b.questions[0].answer,
      isNew: true,
      createdAt: "2026-10-11T08:00:00.000Z",
      dueAt: null,
      next: { again: 0, hard: 1, good: 1, easy: 4 },
    });
  });

  it("a rated question comes back on its day; a fresh bank of the chapter replaces the old one's cards; highlights stay", async () => {
    const h = await highlight(40, at("2026-10-01T10:00:00Z"));
    const b = await bank(40, at("2026-10-10T08:00:00Z"));
    const day = at("2026-10-11T09:00:00Z");
    expect((await reviewQueue(database.db, ownerId, day)).cards).toHaveLength(10);
    const s = await rateCard(database.db, ownerId, `q:${b.id.toUpperCase()}:2`, "good", day);
    expect(s).toMatchObject({ intervalDays: 1, dueAt: at("2026-10-12T00:00:00Z") });
    await rateCard(database.db, ownerId, h.id, "easy", day);
    let q = await reviewQueue(database.db, ownerId, day);
    expect(q.cards.map((c) => c.id)).not.toContain(`q:${b.id}:2`);
    expect(q.cards).toHaveLength(8);
    q = await reviewQueue(database.db, ownerId, at("2026-10-12T09:00:00Z"));
    expect(q.cards[0]).toMatchObject({ id: `q:${b.id}:2`, isNew: false, next: { good: 6 } });

    // A fresh bank: its questions replace the old bank's, from the day after it was made.
    const b2 = await bank(40, at("2026-10-12T10:00:00Z"), true);
    expect(b2.id).not.toBe(b.id);
    q = await reviewQueue(database.db, ownerId, at("2026-10-12T11:00:00Z"));
    expect(q.cards).toEqual([]);
    expect(q.total).toBe(10); // the highlight and the new bank's nine
    q = await reviewQueue(database.db, ownerId, at("2026-10-13T09:00:00Z"));
    expect(q.cards.map((c) => c.id)).toEqual(b2.questions.map((x) => `q:${b2.id}:${x.index}`));
    await expect(rateCard(database.db, ownerId, `q:${b.id}:2`, "good", day)).rejects.toThrow("Card not found.");
    // The highlight keeps its own schedule.
    expect((await reviewQueue(database.db, ownerId, at("2026-10-15T09:00:00Z"))).cards.map((c) => c.id)).toContain(h.id);
  });

  it("refuses a question that is not in the bank, another reader's question, and a removed book's questions", async () => {
    const b = await bank(40, at("2026-10-10T08:00:00Z"));
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const otherId = (await acceptInvite(database.db, token, { email: "r2@example.com", name: "R", password: "long enough pw" })).id;
    await expect(rateCard(database.db, ownerId, `q:${b.id}:99`, "good", DAY0)).rejects.toThrow("Card not found.");
    await expect(rateCard(database.db, ownerId, `x:${b.id}:1`, "good", DAY0)).rejects.toThrow("Card not found.");
    await expect(rateCard(database.db, otherId, `q:${b.id}:1`, "good", DAY0)).rejects.toThrow("Card not found.");
    await removeBook(database.db, ownerId, bookId);
    expect((await reviewQueue(database.db, ownerId, DAY0)).total).toBe(0);
    await expect(rateCard(database.db, ownerId, `q:${b.id}:1`, "good", DAY0)).rejects.toThrow("Card not found.");
  });

  it("the wait is one day unless REVIEW_QUESTION_DELAY_DAYS says otherwise (the browser tests set 0)", () => {
    expect(questionDelayDays({})).toBe(1);
    expect(questionDelayDays({ REVIEW_QUESTION_DELAY_DAYS: "0" })).toBe(0);
    expect(questionDelayDays({ REVIEW_QUESTION_DELAY_DAYS: "3" })).toBe(3);
    for (const v of ["", "-1", "1.5", "lots", "99"]) expect(questionDelayDays({ REVIEW_QUESTION_DELAY_DAYS: v })).toBe(1);
  });
});

describe("What Explain it back found missing, as cards (M28 S2)", () => {
  const summary = "The lawyer Utterson is stern with himself but tolerant of others, and his walk with Enfield turns up a strange door.";

  /** The chapter of paragraph `i`. */
  const chapterOf = (i: number) => chapterFor(database.db, ownerId, bookId, { cfi: paras[i].cfi });

  /** An Explain it back attempt on the chapter of paragraph `i`, made (with its summary note) at `when`. */
  async function attempt(i: number, when: Date, words = summary) {
    const chapter = await chapterOf(i);
    const out = await explainBack(database.db, new FakeModel(), ownerId, { bookId, chapterId: chapter.id, summary: words }, { now: () => when });
    expect(out.error).toBeNull();
    await database.db.update(generations).set({ createdAt: when }).where(eq(generations.id, out.attempt!.id));
    return { id: out.attempt!.id, chapter, items: out.attempt!.items, note: out.note! };
  }

  const gaps = (cards: ReviewCard[]) => cards.filter((c) => c.kind === "gap");

  it("each item with a question is a card from the day after: the question first, the book's own line behind it", async () => {
    const a = await attempt(40, at("2026-10-11T08:00:00Z"));
    expect(a.items).toHaveLength(2);
    expect(a.items.every((i) => i.question)).toBe(true);
    // That day: the summary note is a card (as before M28), the gaps are not; the next card comes the next day.
    let q = await reviewQueue(database.db, ownerId, DAY0);
    expect(q.cards.map((c) => c.id)).toEqual([a.note.id]);
    expect(q.total).toBe(3);
    expect(q.nextDueAt).toBe("2026-10-12T00:00:00.000Z");
    // The next day: one card per item, in Claude's order.
    q = await reviewQueue(database.db, ownerId, at("2026-10-12T00:00:00Z"));
    expect(gaps(q.cards).map((c) => c.id)).toEqual([gapCardId(a.id, 0), gapCardId(a.id, 1)]);
    const parts = await partPassages(database.db, bookId, a.chapter);
    expect(gaps(q.cards)[0]).toEqual({
      id: `g:${a.id}:0`,
      kind: "gap",
      on: "passage",
      bookId,
      bookTitle: expect.stringMatching(/^The Strange Case/),
      bookAuthor: expect.any(String),
      chapter: a.chapter.label,
      cfi: parts[0].cfi,
      quote: a.items[0].quote,
      note: "",
      question: "Test AI question: how does this part open?",
      answer: a.items[0].excerpt,
      isNew: true,
      createdAt: "2026-10-11T08:00:00.000Z",
      dueAt: null,
      next: { again: 0, hard: 1, good: 1, easy: 4 },
    });
    // The question does not give the book's line away.
    expect(gaps(q.cards).every((c) => !c.question.includes(c.quote))).toBe(true);
  });

  it("an attempt stored without questions gives no cards and still shows in Study; a line not found word for word is not quoted", async () => {
    const a = await attempt(40, at("2026-10-10T08:00:00Z"));
    const [row] = await database.db.select().from(generations).where(eq(generations.id, a.id));
    const items = (JSON.parse(row.output) as { items: Record<string, unknown>[] }).items;
    // As stored before M28 S2: no question on any item.
    await database.db
      .update(generations)
      .set({ output: JSON.stringify({ items: items.map((i) => Object.fromEntries(Object.entries(i).filter(([k]) => k !== "question"))) }) })
      .where(eq(generations.id, a.id));
    const day = at("2026-10-12T09:00:00Z");
    let q = await reviewQueue(database.db, ownerId, day);
    expect(gaps(q.cards)).toEqual([]);
    expect(q.cards.map((c) => c.id)).toEqual([a.note.id]);
    const study = await listAttempts(database.db, ownerId, bookId, a.chapter);
    expect(study).toHaveLength(1);
    expect(study[0].items.map((i) => [i.kind, i.quote, i.question])).toEqual(a.items.map((i) => [i.kind, i.quote, ""]));

    // A question on an item whose quote Claude made up: a card, with the passage's start behind it, not a quote.
    await database.db
      .update(generations)
      .set({ output: JSON.stringify({ items: [{ ...items[0], quote: "He loved the theatre above all things.", question: "What did he love?" }] }) })
      .where(eq(generations.id, a.id));
    q = await reviewQueue(database.db, ownerId, day);
    expect(gaps(q.cards)).toMatchObject([{ id: `g:${a.id}:0`, quote: "", question: "What did he love?", answer: a.items[0].excerpt }]);
  });

  it("a rated gap comes back on its day; a newer attempt on the chapter replaces the older one's cards", async () => {
    const a = await attempt(40, at("2026-10-10T08:00:00Z"));
    const day = at("2026-10-11T09:00:00Z");
    const s = await rateCard(database.db, ownerId, `g:${a.id.toUpperCase()}:1`, "good", day);
    expect(s).toMatchObject({ intervalDays: 1, dueAt: at("2026-10-12T00:00:00Z") });
    let q = await reviewQueue(database.db, ownerId, day);
    expect(gaps(q.cards).map((c) => c.id)).toEqual([`g:${a.id}:0`]);
    q = await reviewQueue(database.db, ownerId, at("2026-10-12T09:00:00Z"));
    expect(q.cards[0]).toMatchObject({ id: `g:${a.id}:1`, isNew: false, next: { good: 6 } });

    // A newer attempt with another summary: its gaps replace the older attempt's, from the day after.
    const b = await attempt(40, at("2026-10-12T10:00:00Z"), `${summary} Then Hyde tramples a child.`);
    expect(b.id).not.toBe(a.id);
    q = await reviewQueue(database.db, ownerId, at("2026-10-12T11:00:00Z"));
    expect(gaps(q.cards)).toEqual([]);
    q = await reviewQueue(database.db, ownerId, at("2026-10-13T09:00:00Z"));
    expect(gaps(q.cards).map((c) => c.id)).toEqual([`g:${b.id}:0`, `g:${b.id}:1`]);
    await expect(rateCard(database.db, ownerId, `g:${a.id}:1`, "good", day)).rejects.toThrow("Card not found.");
  });

  it("refuses an item that is not in the attempt, another reader's gap, and a removed book's gaps", async () => {
    const a = await attempt(40, at("2026-10-10T08:00:00Z"));
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const otherId = (await acceptInvite(database.db, token, { email: "r2@example.com", name: "R", password: "long enough pw" })).id;
    await expect(rateCard(database.db, ownerId, `g:${a.id}:99`, "good", DAY0)).rejects.toThrow("Card not found.");
    await expect(rateCard(database.db, ownerId, `q:${a.id}:0`, "good", DAY0)).rejects.toThrow("Card not found.");
    await expect(rateCard(database.db, otherId, `g:${a.id}:0`, "good", DAY0)).rejects.toThrow("Card not found.");
    await removeBook(database.db, ownerId, bookId);
    expect((await reviewQueue(database.db, ownerId, DAY0)).total).toBe(0);
    await expect(rateCard(database.db, ownerId, `g:${a.id}:0`, "good", DAY0)).rejects.toThrow("Card not found.");
  });
});
