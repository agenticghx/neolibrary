import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { seedPath } from "./paths";
import { chapterStatsByBook, cleanChapters, countsForSpeed, recordReading, suggestionsFrom, statsByBook, statsByPathSlot, statsByWeek, weekStart, wordsPerMinute } from "./reading-stats";

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
});
