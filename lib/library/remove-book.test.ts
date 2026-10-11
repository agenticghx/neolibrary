import { readFileSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books, slots } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, listAnnotations } from "./annotations";
import { exportLibrary, importLibrary, wipeLibrary } from "./export";
import { importBook } from "./import";
import { seedPath } from "./paths";
import { recordReading, statsByBook, statsByWeek } from "./reading-stats";
import { listRemovedBooks, removeBook, restoreBook } from "./remove-book";
import { searchLibrary, searchNotes } from "./search";
import { createCollection, listCollections, listShelf, setInCollection } from "./shelf";

// M19 P3b (the site review's third finding): a book can leave the library and come back. Its file, notes and
// reading history are kept; every shelf, search, count and per-book statistic leaves it out meanwhile.

let database: Database;
let ownerId: string;
const storage = new MemoryStorage();
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url)));

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

describe("removing a book from the library", () => {
  it("leaves every shelf, search, count and per-book statistic, and comes back with its notes", async () => {
    const db = database.db;
    const { bookId } = await importBook(db, storage, ownerId, { name: "tm.epub", bytes: fixture("wells-the-time-machine.epub") });
    const c = await createCollection(db, ownerId, "Time travel");
    await setInCollection(db, ownerId, c.id, bookId, true);
    await createAnnotation(db, ownerId, { kind: "note", bookId, body: "Morlocks and Eloi" });
    await recordReading(db, ownerId, {
      sessionId: "11111111-2222-4333-8444-555555555555",
      bookId,
      startedAt: new Date().toISOString(),
      activeSeconds: 300,
      words: 1250,
      pages: 4,
      chapters: [],
    });
    const seen = async () => ({
      shelf: (await listShelf(db, ownerId)).map((b) => b.title),
      search: (await searchLibrary(db, ownerId, "Time Traveller")).length > 0,
      notes: (await searchNotes(db, ownerId, "Morlocks")).length,
      collection: (await listCollections(db, ownerId)).find((x) => x.id === c.id)?.count,
      stats: (await statsByBook(db, ownerId)).map((s) => s.title),
    });
    expect(await seen()).toEqual({ shelf: ["The Time Machine"], search: true, notes: 1, collection: 1, stats: ["The Time Machine"] });
    const weekBefore = (await statsByWeek(db, ownerId)).reduce((n, w) => n + w.activeSeconds, 0);

    await removeBook(db, ownerId, bookId);
    expect(await seen()).toEqual({ shelf: [], search: false, notes: 0, collection: 0, stats: [] });
    // The reading happened: the weekly totals keep its time.
    expect((await statsByWeek(db, ownerId)).reduce((n, w) => n + w.activeSeconds, 0)).toBe(weekBefore);
    expect((await listRemovedBooks(db, ownerId)).map((b) => [b.id, b.title])).toEqual([[bookId, "The Time Machine"]]);
    // Nothing is erased: the notes are still stored.
    expect((await listAnnotations(db, ownerId, bookId)).map((a) => a.body)).toEqual(["Morlocks and Eloi"]);
    await expect(removeBook(db, ownerId, bookId)).rejects.toThrow("Book not found.");

    await restoreBook(db, ownerId, bookId);
    expect(await seen()).toEqual({ shelf: ["The Time Machine"], search: true, notes: 1, collection: 1, stats: ["The Time Machine"] });
    expect(await listRemovedBooks(db, ownerId)).toEqual([]);
    await expect(restoreBook(db, ownerId, bookId)).rejects.toThrow("Book not found.");
  });

  it("is refused for another reader's book, a title with no file, and a book that fills a title on a Path", async () => {
    const db = database.db;
    const { bookId } = await importBook(db, storage, ownerId, { name: "j.epub", bytes: fixture("stevenson-jekyll-and-hyde.epub") });
    const { token } = await createInvite(db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
    const other = (await acceptInvite(db, token, { email: "x@example.com", name: "X", password: "long enough pw" })).id;
    await expect(removeBook(db, other, bookId)).rejects.toThrow("Book not found.");
    await removeBook(db, ownerId, bookId);
    await expect(restoreBook(db, other, bookId)).rejects.toThrow("Book not found.");
    expect(await listRemovedBooks(db, other)).toEqual([]);
    await expect(removeBook(db, ownerId, "not-a-uuid")).rejects.toThrow("Book not found.");

    await seedPath(db, ownerId, hiddenMachinery);
    const [waiting] = await db
      .select({ id: books.id })
      .from(books)
      .innerJoin(slots, eq(slots.bookId, books.id))
      .where(and(eq(books.ownerId, ownerId), isNull(books.fileKey)))
      .limit(1);
    await expect(removeBook(db, ownerId, waiting.id)).rejects.toThrow("A title without its book file");
    // Its file attached, it fills that title on the Path, so it stays.
    await importBook(db, storage, ownerId, { name: "f.epub", bytes: fixture("shelley-frankenstein.epub") }, { attachTo: waiting.id });
    await expect(removeBook(db, ownerId, waiting.id)).rejects.toThrow(`This book is part of ${hiddenMachinery.title}, so it stays in your library.`);
  });

  it("uploading a removed book again brings it back, with its notes, instead of a second copy", async () => {
    const db = database.db;
    const bytes = fixture("wells-the-time-machine.epub");
    const { bookId } = await importBook(db, storage, ownerId, { name: "tm.epub", bytes });
    await createAnnotation(db, ownerId, { kind: "note", bookId, body: "Kept" });
    await removeBook(db, ownerId, bookId);
    expect(await importBook(db, storage, ownerId, { name: "tm.epub", bytes })).toEqual({ status: "restored", bookId, title: "The Time Machine" });
    expect((await listShelf(db, ownerId)).map((b) => b.id)).toEqual([bookId]);
    expect((await listAnnotations(db, ownerId, bookId)).map((a) => a.body)).toEqual(["Kept"]);
    expect((await importBook(db, storage, ownerId, { name: "tm.epub", bytes })).status).toBe("duplicate");
  });

  it("a removed book goes into the library file and comes back from it still removed (ground rule 7)", async () => {
    const db = database.db;
    const { bookId } = await importBook(db, storage, ownerId, { name: "tm.epub", bytes: fixture("wells-the-time-machine.epub") });
    await createAnnotation(db, ownerId, { kind: "note", bookId, body: "Travels with the book" });
    await removeBook(db, ownerId, bookId);
    const file = await exportLibrary(db, ownerId);
    expect(file.books.find((b) => b.id === bookId)?.deletedAt).toEqual(expect.any(String));
    await wipeLibrary(db, ownerId);
    await importLibrary(db, ownerId, JSON.parse(JSON.stringify(file)));
    expect((await listRemovedBooks(db, ownerId)).map((b) => b.id)).toEqual([bookId]);
    expect(await listShelf(db, ownerId)).toEqual([]);
    expect((await listAnnotations(db, ownerId, bookId)).map((a) => a.body)).toEqual(["Travels with the book"]);
    // A removal date that is not a date is refused, and nothing is written.
    await wipeLibrary(db, ownerId);
    const bad = JSON.parse(JSON.stringify(file));
    bad.books.find((b: { id: string }) => b.id === bookId).deletedAt = "yesterday";
    await expect(importLibrary(db, ownerId, bad)).rejects.toThrow("removal date that is not a date");
  });
});
