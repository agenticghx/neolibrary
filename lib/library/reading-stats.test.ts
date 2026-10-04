import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { recordReading, statsByBook, wordsPerMinute } from "./reading-stats";

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
});
