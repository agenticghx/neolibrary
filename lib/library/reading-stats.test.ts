import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, deleteAnnotation, updateAnnotation } from "./annotations";
import { importBook } from "./import";
import { seedPath } from "./paths";
import { removeBook } from "./remove-book";
import {
  chapterStatsByBook,
  cleanChapters,
  cleanFocus,
  countsForSpeed,
  focusSessions,
  linkFocusAnswer,
  recordReading,
  readingCalendar,
  suggestionsFrom,
  statsByBook,
  statsByPathSlot,
  statsByWeek,
  weekStart,
  wordsPerMinute,
} from "./reading-stats";
import { endFocus, startFocus, startWait } from "./focus-lock";

let database: Database;
let ownerId: string;
let jekyll: string;
let tm: string;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const load = (f: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${f}`, import.meta.url)));
  const storage = new MemoryStorage();
  jekyll = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: load("stevenson-jekyll-and-hyde.epub") })).bookId;
  tm = (await importBook(database.db, storage, ownerId, { name: "tm.epub", bytes: load("wells-the-time-machine.epub") })).bookId;
});
afterEach(() => database.raw.close());

const s1 = "aaaaaaaa-0000-4000-8000-000000000001";
const s2 = "aaaaaaaa-0000-4000-8000-000000000002";

describe("reading statistics (M10)", () => {
  it("words per minute is words over active minutes, and nothing under a minute", () => {
    expect(wordsPerMinute(500, 120)).toBe(250);
    expect(wordsPerMinute(1000, 270)).toBe(222);
    expect(wordsPerMinute(100, 59)).toBeNull();
    expect(wordsPerMinute(0, 600)).toBe(0);
  });

  it("adds sittings up per book; repeated or late reports of a sitting never count twice", async () => {
    const at = "2026-10-04T09:00:00Z";
    await recordReading(database.db, ownerId, { sessionId: s1, bookId: jekyll, startedAt: at, activeSeconds: 60, words: 230, pages: 1 });
    await recordReading(database.db, ownerId, { sessionId: s1, bookId: jekyll, startedAt: at, activeSeconds: 120, words: 480, pages: 2 });
    // A late, smaller report of the same sitting changes nothing.
    await recordReading(database.db, ownerId, { sessionId: s1, bookId: jekyll, startedAt: at, activeSeconds: 60, words: 230, pages: 1 });
    await recordReading(database.db, ownerId, { sessionId: s2, bookId: tm, startedAt: at, activeSeconds: 600, words: 2000, pages: 8 });
    expect(await statsByBook(database.db, ownerId)).toEqual([
      expect.objectContaining({ bookId: tm, title: "The Time Machine", activeSeconds: 600, words: 2000, pages: 8, sessions: 1, wpm: 200 }),
      expect.objectContaining({ bookId: jekyll, activeSeconds: 120, words: 480, pages: 2, sessions: 1, wpm: 240 }),
    ]);
  });

  it("refuses other readers' books and sittings, and caps unbelievable numbers", async () => {
    const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const other = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    await expect(recordReading(database.db, other, { sessionId: s1, bookId: jekyll, startedAt: "", activeSeconds: 60, words: 1, pages: 1 })).rejects.toThrow(
      "Book not found",
    );
    await expect(recordReading(database.db, ownerId, { sessionId: "x", bookId: jekyll, startedAt: "", activeSeconds: 1, words: 1, pages: 1 })).rejects.toThrow(
      "Bad session",
    );
    await recordReading(database.db, ownerId, { sessionId: s1, bookId: jekyll, startedAt: "nonsense", activeSeconds: 1e9, words: -5, pages: "x" });
    expect((await statsByBook(database.db, ownerId))[0]).toMatchObject({ activeSeconds: 12 * 3600, words: 0, pages: 0 });
  });

  it("groups reading by pillar and by N or E slot; a book in two pillars counts in both, once in each", async () => {
    await seedPath(database.db, ownerId, {
      slug: "test",
      title: "Test path",
      description: "",
      sourceUrl: "",
      pillars: [
        { slug: "a", title: "Machines", group: "main", books: [{ kind: "N", title: "The Time Machine", author: "Wells" }, { kind: "E", title: "The Strange Case of Dr. Jekyll and Mr. Hyde", author: "Stevenson" }] },
        { slug: "b", title: "Doubles", group: "main", books: [{ kind: "N", title: "The Strange Case of Dr. Jekyll and Mr. Hyde", author: "Stevenson" }, { kind: "E", title: "Unread Book", author: "Nobody" }] },
      ],
    });
    const at = "2026-10-04T09:00:00Z";
    await recordReading(database.db, ownerId, { sessionId: s1, bookId: tm, startedAt: at, activeSeconds: 600, words: 2000, pages: 8 });
    await recordReading(database.db, ownerId, { sessionId: s2, bookId: jekyll, startedAt: at, activeSeconds: 120, words: 480, pages: 2 });
    const { pillars, kinds } = await statsByPathSlot(database.db, ownerId);
    expect(pillars).toEqual([
      expect.objectContaining({ title: "Machines", path: "Test path", activeSeconds: 720, words: 2480, books: 2, wpm: 207 }),
      expect.objectContaining({ title: "Doubles", activeSeconds: 120, words: 480, books: 1, wpm: 240 }),
    ]);
    // Jekyll is E in one pillar and N in the other, so it is in both groups; Time Machine only in N.
    expect(kinds).toEqual([
      { kind: "N", activeSeconds: 720, words: 2480, books: 2, wpm: 207 },
      { kind: "E", activeSeconds: 120, words: 480, books: 1, wpm: 240 },
    ]);
    // A reader with no reading has no groups.
    expect((await statsByPathSlot(database.db, "00000000-0000-4000-8000-000000000000")).pillars).toEqual([]);
  });

  it("weeks start on Monday (UTC); weeks without reading between are zeros, before the first are left out", async () => {
    expect(weekStart(new Date("2026-10-04T23:30:00Z"))).toBe("2026-09-28"); // a Sunday
    expect(weekStart(new Date("2026-10-05T00:00:00Z"))).toBe("2026-10-05"); // a Monday
    const now = new Date("2026-10-14T12:00:00Z");
    expect(await statsByWeek(database.db, ownerId, now)).toEqual([]);
    await recordReading(database.db, ownerId, { sessionId: s1, bookId: tm, startedAt: "2026-09-22T09:00:00Z", activeSeconds: 600, words: 2000, pages: 8 }, now);
    await recordReading(database.db, ownerId, { sessionId: s2, bookId: jekyll, startedAt: "2026-10-12T09:00:00Z", activeSeconds: 120, words: 480, pages: 2 }, now);
    await recordReading(
      database.db,
      ownerId,
      { sessionId: "aaaaaaaa-0000-4000-8000-000000000003", bookId: jekyll, startedAt: "2026-10-13T09:00:00Z", activeSeconds: 120, words: 400, pages: 2 },
      now,
    );
    expect(await statsByWeek(database.db, ownerId, now)).toEqual([
      { weekStart: "2026-09-21", activeSeconds: 600, words: 2000, sessions: 1, wpm: 200 },
      { weekStart: "2026-09-28", activeSeconds: 0, words: 0, sessions: 0, wpm: null },
      { weekStart: "2026-10-05", activeSeconds: 0, words: 0, sessions: 0, wpm: null },
      { weekStart: "2026-10-12", activeSeconds: 240, words: 880, sessions: 2, wpm: 220 },
    ]);
    // Only the last `weeks` weeks are shown.
    expect((await statsByWeek(database.db, ownerId, now, 2)).map((w) => w.weekStart)).toEqual(["2026-10-12"]);
  });

  it("flicking through pages adds words read but not speed (under a minute, or over 1,000 words per minute)", async () => {
    expect(countsForSpeed(200, 60)).toBe(true);
    expect(countsForSpeed(8000, 30)).toBe(false); // under a minute
    expect(countsForSpeed(5000, 120)).toBe(false); // 2,500 words per minute
    expect(countsForSpeed(2000, 120)).toBe(true); // exactly 1,000
    const at = "2026-10-04T09:00:00Z";
    await recordReading(database.db, ownerId, { sessionId: s1, bookId: jekyll, startedAt: at, activeSeconds: 120, words: 480, pages: 2 });
    await recordReading(database.db, ownerId, { sessionId: s2, bookId: jekyll, startedAt: at, activeSeconds: 20, words: 8000, pages: 40 });
    const s3 = "aaaaaaaa-0000-4000-8000-000000000003";
    await recordReading(database.db, ownerId, { sessionId: s3, bookId: jekyll, startedAt: at, activeSeconds: 120, words: 5000, pages: 20 });
    // All the words count; speed is 480 words in 2 minutes, from the one real sitting.
    expect((await statsByBook(database.db, ownerId))[0]).toMatchObject({ activeSeconds: 260, words: 13480, sessions: 3, wpm: 240 });
    expect((await statsByWeek(database.db, ownerId, new Date(at)))[0]).toMatchObject({ activeSeconds: 260, words: 13480, sessions: 3, wpm: 240 });
  });

  it("checks the chapter split: known fields, sane numbers, never more than the sitting", () => {
    expect(
      cleanChapters(
        [
          { key: "c1.xhtml", label: "  Chapter\n One ", position: 0.1, activeSeconds: 90, words: 300, extra: "x" },
          { key: "c1.xhtml", label: "duplicate", position: 0.2, activeSeconds: 5, words: 5 },
          { key: "", label: "no key" },
          "nonsense",
          { key: "c2.xhtml", label: 7, position: 9, activeSeconds: 1e9, words: -3 },
        ],
        120,
        500,
      ),
    ).toEqual([
      { key: "c1.xhtml", label: "Chapter One", position: 0.1, activeSeconds: 90, words: 300 },
      { key: "c2.xhtml", label: "", position: 1, activeSeconds: 120, words: 0 },
    ]);
    expect(cleanChapters("x", 1, 1)).toEqual([]);
  });

  it("per-chapter speed across sittings; a chapter read much slower than usual gets a suggestion", async () => {
    const ch = (n: number, activeSeconds: number, words: number) => ({ key: `c${n}.xhtml`, label: `Chapter ${n}`, position: n / 10, activeSeconds, words });
    const at = "2026-10-04T09:00:00Z";
    // Sitting 1: chapters 1 and 2 at 250 wpm. Sitting 2: chapter 3 at 250, chapter 4 at 100.
    await recordReading(database.db, ownerId, { sessionId: s1, bookId: tm, startedAt: at, activeSeconds: 360, words: 1500, pages: 6, chapters: [ch(1, 180, 750), ch(2, 180, 750)] });
    await recordReading(database.db, ownerId, {
      sessionId: s2,
      bookId: tm,
      startedAt: at,
      activeSeconds: 420,
      words: 1050,
      pages: 5,
      chapters: [ch(4, 240, 400), ch(3, 180, 750)],
    });
    // A late report of sitting 2 with less time does not replace its chapter split.
    await recordReading(database.db, ownerId, { sessionId: s2, bookId: tm, startedAt: at, activeSeconds: 60, words: 100, pages: 1, chapters: [ch(4, 60, 100)] });
    // Chapter 5: a flick (10 s) and a short read (90 s): under two minutes of countable reading, so left out.
    const s3 = "aaaaaaaa-0000-4000-8000-000000000003";
    await recordReading(database.db, ownerId, { sessionId: s3, bookId: tm, startedAt: at, activeSeconds: 100, words: 3300, pages: 9, chapters: [{ ...ch(5, 10, 3000) }, { ...ch(6, 90, 300) }] });
    const books = await chapterStatsByBook(database.db, ownerId);
    expect(books).toEqual([
      {
        bookId: tm,
        title: "The Time Machine",
        chapters: [
          { key: "c1.xhtml", label: "Chapter 1", position: 0.1, activeSeconds: 180, words: 750, wpm: 250 },
          { key: "c2.xhtml", label: "Chapter 2", position: 0.2, activeSeconds: 180, words: 750, wpm: 250 },
          { key: "c3.xhtml", label: "Chapter 3", position: 0.3, activeSeconds: 180, words: 750, wpm: 250 },
          { key: "c4.xhtml", label: "Chapter 4", position: 0.4, activeSeconds: 240, words: 400, wpm: 100 },
        ],
      },
    ]);
    expect(suggestionsFrom(books)).toEqual([{ bookId: tm, title: "The Time Machine", chapterKey: "c4.xhtml", chapter: "Chapter 4", chapterWpm: 100, usualWpm: 250 }]);
    // Steady reading, or too few chapters, suggests nothing.
    expect(suggestionsFrom([{ ...books[0], chapters: books[0].chapters.slice(0, 3) }])).toEqual([]);
    expect(suggestionsFrom([{ ...books[0], chapters: books[0].chapters.slice(2) }])).toEqual([]);
  });

  it("the reading calendar (M21) adds up each UTC day from the stored sittings, also of a removed book, and other readers' never", async () => {
    const now = new Date("2026-10-11T15:00:00Z");
    const sit = (id: number, bookId: string, startedAt: string, activeSeconds: number) =>
      recordReading(database.db, ownerId, { sessionId: `aaaaaaaa-0000-4000-8000-00000000000${id}`, bookId, startedAt, activeSeconds, words: activeSeconds * 4, pages: 1 }, now);
    await sit(1, tm, "2026-10-10T09:00:00Z", 600);
    await sit(2, jekyll, "2026-10-10T23:30:00Z", 900); // still the 10th in UTC
    await sit(3, tm, "2026-10-11T00:15:00+02:00", 300); // 22:15 UTC on the 10th
    await sit(4, jekyll, "2026-10-11T08:00:00Z", 1500);
    await sit(5, tm, "2026-01-05T08:00:00Z", 7200); // long before the calendar: the best day all the same
    await removeBook(database.db, ownerId, jekyll, now);
    const cal = await readingCalendar(database.db, ownerId, now);
    const last = cal.weeks.at(-1)!;
    expect(last[5]).toEqual({ date: "2026-10-10", seconds: 1800, step: 3, today: false });
    expect(last[6]).toEqual({ date: "2026-10-11", seconds: 1500, step: 2, today: true });
    expect(cal).toMatchObject({ current: 2, longest: 2, best: { date: "2026-01-05", seconds: 7200 }, daysRead: 2 });
    expect((await readingCalendar(database.db, "00000000-0000-4000-8000-000000000000", now)).daysRead).toBe(0);
  });
});

const f1 = "ffffffff-0000-4000-8000-000000000001";
const f2 = "ffffffff-0000-4000-8000-000000000002";

describe("a focus session with a question (M26 R3)", () => {
  it("checks the reader's report of the session: a proper id, a one-line question, a note id or nothing", () => {
    expect(cleanFocus(undefined)).toBeNull();
    expect(cleanFocus({ id: "nope", question: "Q" })).toBeNull();
    expect(cleanFocus({ id: f1.toUpperCase(), question: "  Why\n go  forward? ", answerAnnotationId: "x" })).toEqual({ id: f1, question: "Why go forward?", answerAnnotationId: null });
    expect(cleanFocus({ id: f1, question: 5, answerAnnotationId: s1 })).toEqual({ id: f1, question: "", answerAnnotationId: s1 });
  });

  it("says how each session ended, from the server's record of it (M26 R4b)", async () => {
    const answered = await startFocus(database.db, ownerId, { bookId: tm, question: "Why forward?", minutes: 30 }, new Date("2026-10-18T09:00:00Z"));
    await endFocus(database.db, ownerId, answered.id, { answered: true }, new Date("2026-10-18T09:10:00Z"));
    const waited = await startFocus(database.db, ownerId, { bookId: tm, question: "Why the Eloi?", minutes: 30 }, new Date("2026-10-18T10:00:00Z"));
    await startWait(database.db, ownerId, waited.id, new Date("2026-10-18T10:05:00Z"), 600_000);
    await endFocus(database.db, ownerId, waited.id, { answered: false }, new Date("2026-10-18T10:15:00Z"));
    for (const [f, sessionId, startedAt] of [
      [answered, s1, "2026-10-18T09:00:00Z"],
      [waited, s2, "2026-10-18T10:00:00Z"],
    ] as const) {
      await recordReading(database.db, ownerId, { sessionId, bookId: tm, startedAt, activeSeconds: 60, words: 200, pages: 1, focus: { id: f.id, question: f.question } });
    }
    expect((await focusSessions(database.db, ownerId)).map((f) => [f.question, f.endedHow])).toEqual([
      ["Why the Eloi?", "waited"],
      ["Why forward?", "answered"],
    ]);
  });

  it("a sitting keeps its session and question; a reload makes a second sitting of the same session; the answer links them", async () => {
    const at = "2026-10-18T09:00:00Z";
    const focus = { id: f1, question: "Why does the Time Traveller go forward, not back?" };
    await recordReading(database.db, ownerId, { sessionId: s1, bookId: tm, startedAt: at, activeSeconds: 60, words: 230, pages: 1, focus });
    // A later report of the same sitting without the session (the session ended) keeps it.
    await recordReading(database.db, ownerId, { sessionId: s1, bookId: tm, startedAt: at, activeSeconds: 120, words: 460, pages: 2 });
    // After a reload, a new sitting in the same session.
    await recordReading(database.db, ownerId, { sessionId: s2, bookId: tm, startedAt: "2026-10-18T09:03:00Z", activeSeconds: 60, words: 200, pages: 1, focus });
    let [session] = await focusSessions(database.db, ownerId);
    expect(session).toEqual({
      focusId: f1,
      bookId: tm,
      title: "The Time Machine",
      startedAt: "2026-10-18T09:00:00.000Z",
      activeSeconds: 180,
      words: 660,
      question: focus.question,
      answer: null,
      // No server row for this session (as for one from before M26 R4a): nothing is said about how it ended.
      endedHow: null,
    });

    // The answer, saved as a note on the book, links every sitting of the session.
    const note = await createAnnotation(database.db, ownerId, { kind: "note", bookId: tm, body: "Question: Why?\n\nAnswer: Because the future is unknown." });
    expect(await linkFocusAnswer(database.db, ownerId, f1, note.id)).toBe(2);
    [session] = await focusSessions(database.db, ownerId);
    expect(session.answer).toBe("Question: Why?\n\nAnswer: Because the future is unknown.");
    // The note's latest words are the answer shown (notes are never overwritten: a new version is added).
    await updateAnnotation(database.db, ownerId, note.id, { body: "Question: Why?\n\nAnswer: Because the past is written." });
    expect((await focusSessions(database.db, ownerId))[0].answer).toBe("Question: Why?\n\nAnswer: Because the past is written.");
    // A removed note is no answer.
    await deleteAnnotation(database.db, ownerId, note.id);
    expect((await focusSessions(database.db, ownerId))[0].answer).toBeNull();

    // Sessions come newest first; a sitting without a session is not one.
    await recordReading(database.db, ownerId, { sessionId: "aaaaaaaa-0000-4000-8000-000000000003", bookId: jekyll, startedAt: "2026-10-19T09:00:00Z", activeSeconds: 60, words: 100, pages: 1 });
    await recordReading(database.db, ownerId, {
      sessionId: "aaaaaaaa-0000-4000-8000-000000000004",
      bookId: jekyll,
      startedAt: "2026-10-20T09:00:00Z",
      activeSeconds: 90,
      words: 150,
      pages: 1,
      focus: { id: f2, question: "What is Hyde to Jekyll?" },
    });
    expect((await focusSessions(database.db, ownerId)).map((x) => [x.focusId, x.title, x.activeSeconds])).toEqual([
      [f2, "The Strange Case of Dr. Jekyll and Mr. Hyde", 90],
      [f1, "The Time Machine", 180],
    ]);

    // Bad ids are refused; another reader's session is not touched.
    await expect(linkFocusAnswer(database.db, ownerId, "nope", note.id)).rejects.toThrow("Bad focus session.");
    await expect(linkFocusAnswer(database.db, ownerId, f1, "nope")).rejects.toThrow("Bad note.");
    expect(await linkFocusAnswer(database.db, "00000000-0000-4000-8000-000000000099", f1, note.id)).toBe(0);
  });
});
