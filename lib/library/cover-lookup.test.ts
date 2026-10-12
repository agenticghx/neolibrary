import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import { bookPng } from "@/lib/covers/fake-png";
import { CoverSourceError, FakeCovers, type CoverCandidate, type CoverSource } from "@/lib/covers/sources";
import type { Database } from "@/lib/db/client";
import { books, users } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { coverCounts, CoverError, findMissingCovers, foundCoverKey, rejectCover, RECHECK_DAYS } from "./cover-lookup";
import { startCoverRun } from "./cover-job";
import { importBook } from "./import";

let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let otherId: string;
const NOW = new Date("2026-10-11T22:00:00Z");
const now = () => NOW;

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  [{ id: otherId }] = await database.db.insert(users).values({ email: "r@example.com", name: "R", passwordHash: "x", role: "reader" }).returning({ id: users.id });
});
afterEach(() => database.raw.close());

const addTitle = async (owner: string, title: string, author: string) =>
  (await database.db.insert(books).values({ ownerId: owner, title, author }).returning({ id: books.id }))[0].id;
const book = async (id: string) => (await database.db.select().from(books).where(eq(books.id, id)))[0];
const fixture = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url))) });

describe("finding covers for titles", () => {
  it("stores a found cover under its own name with where it came from, and marks a title the catalogues lack", async () => {
    const grid = await addTitle(ownerId, "The Grid", "Bakke");
    const oil = await addTitle(ownerId, "Oil 101", "Downey");
    const withFile = (await importBook(database.db, storage, ownerId, fixture("stevenson-jekyll-and-hyde.epub"))).bookId;
    const fake = new FakeCovers();

    const r = await findMissingCovers(database.db, storage, fake, { now });
    expect(r).toEqual({ done: 2, total: 2, found: 1, failed: 0, stopped: false });
    const g = await book(grid);
    expect(g).toMatchObject({
      coverKey: foundCoverKey(ownerId, grid, "https://covers.example.org/fake/the-grid/1.png", "png"),
      coverSource: "fake",
      coverRef: "https://covers.example.org/fake/the-grid/1.png",
      coverPage: "https://catalogue.example.org/fake/the-grid",
      coverCheckedAt: NOW,
      coverRejected: [],
    });
    expect((await storage.get(g.coverKey!))?.contentType).toBe("image/png");
    expect(await book(oil)).toMatchObject({ coverKey: null, coverSource: null, coverCheckedAt: NOW });
    // The book with its own cover was not asked about, and keeps it.
    expect(fake.finds).toEqual(["The Grid", "Oil 101"]);
    expect(await book(withFile)).toMatchObject({ coverSource: "file", coverKey: `covers/${ownerId}/${withFile}.svg` });
    expect(await coverCounts(database.db, ownerId)).toEqual({ found: 1, none: 1 });
  });

  it("asks again about a title only after RECHECK_DAYS, or when told to", async () => {
    const oil = await addTitle(ownerId, "Oil 101", "Downey");
    const fake = new FakeCovers();
    await findMissingCovers(database.db, storage, fake, { now });
    expect((await findMissingCovers(database.db, storage, fake, { now })).total).toBe(0);
    expect((await findMissingCovers(database.db, storage, fake, { now, force: true })).total).toBe(1);
    const later = () => new Date(NOW.getTime() + (RECHECK_DAYS + 1) * 86_400_000);
    expect((await findMissingCovers(database.db, storage, fake, { now: later })).total).toBe(1);
    expect(fake.finds).toEqual(["Oil 101", "Oil 101", "Oil 101"]);
    expect((await book(oil)).coverKey).toBeNull();
  });

  it("asks the catalogue once for a title two readers share, and gives each reader their own copy", async () => {
    const mine = await addTitle(ownerId, "Chip War", "Miller");
    const theirs = await addTitle(otherId, "Chip War", "Chris Miller");
    const fake = new FakeCovers();
    expect((await findMissingCovers(database.db, storage, fake, { now })).found).toBe(2);
    expect(fake.finds).toEqual(["Chip War"]);
    expect(fake.downloads.length).toBe(1);
    const chipWar = "https://covers.example.org/fake/chip-war/1.png";
    expect((await book(mine)).coverKey).toBe(foundCoverKey(ownerId, mine, chipWar, "png"));
    expect((await book(theirs)).coverKey).toBe(foundCoverKey(otherId, theirs, chipWar, "png"));
    // One reader's run leaves the other reader's titles alone.
    const solo = await addTitle(otherId, "Tubes", "Blum");
    await findMissingCovers(database.db, storage, fake, { now, ownerId });
    expect((await book(solo)).coverCheckedAt).toBeNull();
  });

  it("Not this cover: the next match takes its place, and a title turned down twice keeps its drawn cover for good", async () => {
    const grid = await addTitle(ownerId, "The Grid", "Bakke");
    const fake = new FakeCovers();
    await findMissingCovers(database.db, storage, fake, { now });
    const first = (await book(grid)).coverKey!;

    expect(await rejectCover(database.db, storage, fake, ownerId, grid, now)).toBe("replaced");
    const b = await book(grid);
    expect(b).toMatchObject({ coverRef: "https://covers.example.org/fake/the-grid/2.png", isbn: "9780000000002", coverRejected: ["https://covers.example.org/fake/the-grid/1.png"] });
    expect(b.coverKey).not.toBe(first); // a new name for the new picture
    expect(await storage.get(first)).toBeNull();
    expect(await storage.get(b.coverKey!)).not.toBeNull();

    expect(await rejectCover(database.db, storage, fake, ownerId, grid, now)).toBe("cleared");
    expect(await book(grid)).toMatchObject({ coverKey: null, coverSource: null, coverRef: null, coverPage: null, coverRejected: [expect.stringContaining("/1.png"), expect.stringContaining("/2.png")] });
    await findMissingCovers(database.db, storage, fake, { now, force: true });
    expect((await book(grid)).coverKey).toBeNull();
  });

  it("will not take back a cover from the book's file, or touch another reader's book", async () => {
    const withFile = (await importBook(database.db, storage, ownerId, fixture("stevenson-jekyll-and-hyde.epub"))).bookId;
    await expect(rejectCover(database.db, storage, new FakeCovers(), ownerId, withFile)).rejects.toThrow(CoverError);
    const theirs = await addTitle(otherId, "The Grid", "Bakke");
    await findMissingCovers(database.db, storage, new FakeCovers(), { now });
    await expect(rejectCover(database.db, storage, new FakeCovers(), ownerId, theirs)).rejects.toThrow("Book not found.");
    await expect(rejectCover(database.db, storage, new FakeCovers(), ownerId, "not-a-uuid")).rejects.toThrow("Book not found.");
  });

  it("skips a picture that is not a cover and keeps the next; drops its own copy if the book file's cover arrived meanwhile", async () => {
    const grid = await addTitle(ownerId, "The Grid", "Bakke");
    const candidates: CoverCandidate[] = [1, 2].map((n) => ({ source: "fake", imageUrl: `https://x.example.org/${n}.png`, pageUrl: "https://x.example.org/", title: "The Grid", authors: ["Bakke"], isbn: null }));
    const banner: CoverSource = {
      name: "fake",
      find: async () => candidates,
      download: async (c) => (c.imageUrl.endsWith("1.png") ? bookPng(400, 100, [0, 0, 0]) : bookPng(120, 180, [1, 2, 3])),
      isbnOf: async () => null,
    };
    await findMissingCovers(database.db, storage, banner, { now });
    expect((await book(grid)).coverRef).toBe("https://x.example.org/2.png");

    const late = await addTitle(ownerId, "Tubes", "Blum");
    const racing: CoverSource = {
      ...banner,
      download: async () => {
        await database.db.update(books).set({ coverKey: `covers/${ownerId}/${late}.jpg`, coverSource: "file" }).where(eq(books.id, late));
        return bookPng(120, 180, [1, 2, 3]);
      },
    };
    expect((await findMissingCovers(database.db, storage, racing, { now })).found).toBe(0);
    expect(await storage.get(foundCoverKey(ownerId, late, "https://x.example.org/1.png", "png"))).toBeNull();
    expect((await book(late)).coverSource).toBe("file");
  });

  it("stops after a catalogue fails three times in a row, leaving those titles to be asked again", async () => {
    for (const t of ["A", "B", "C", "D"]) await addTitle(ownerId, t, "X");
    const down: CoverSource = {
      name: "fake",
      find: async () => {
        throw new CoverSourceError("Open Library could not search (503).");
      },
      download: async () => null,
      isbnOf: async () => null,
    };
    const r = await findMissingCovers(database.db, storage, down, { now });
    expect(r).toMatchObject({ total: 4, done: 2, failed: 3, stopped: true, found: 0 });
    expect((await database.db.select({ c: books.coverCheckedAt }).from(books)).every((b) => b.c === null)).toBe(true);
  });
});

describe("a book file and a found cover", () => {
  it("an EPUB's own cover replaces the found one (whose picture is deleted); a PDF without one keeps it", async () => {
    const jekyll = await addTitle(ownerId, "The Strange Case of Dr. Jekyll and Mr. Hyde", "Stevenson");
    const meditations = await addTitle(ownerId, "Meditations on First Philosophy", "Descartes");
    await findMissingCovers(database.db, storage, new FakeCovers(), { now });
    const found = (await book(jekyll)).coverKey!;

    await importBook(database.db, storage, ownerId, fixture("stevenson-jekyll-and-hyde.epub"), { attachTo: jekyll });
    expect(await book(jekyll)).toMatchObject({ coverKey: `covers/${ownerId}/${jekyll}.svg`, coverSource: "file", coverRef: null, coverPage: null });
    expect(await storage.get(found)).toBeNull();

    await importBook(database.db, storage, ownerId, fixture("descartes-meditation-one.pdf"), { attachTo: meditations });
    expect(await book(meditations)).toMatchObject({
      coverKey: foundCoverKey(ownerId, meditations, "https://covers.example.org/fake/meditations-on-first-philosophy/1.png", "png"),
      coverSource: "fake",
      fileType: "pdf",
    });
  });
});

describe("the background run", () => {
  it("runs once at a time: a second start gets the run in progress, with its progress", async () => {
    await addTitle(ownerId, "The Grid", "Bakke");
    const a = startCoverRun(database.db, storage, { source: new FakeCovers(), now });
    const b = startCoverRun(database.db, storage, { source: new FakeCovers(), now });
    expect(b).toBe(a);
    expect(await a.promise).toMatchObject({ total: 1, found: 1 });
    expect(a.progress).toEqual({ done: 1, total: 1, found: 1 });
    // Once it has ended, the next start is a new run (awaited, so it does not outlive the test's database).
    const c = startCoverRun(database.db, storage, { source: new FakeCovers(), now });
    expect(c).not.toBe(a);
    expect(await c.promise).toMatchObject({ total: 0 });
  });
});
