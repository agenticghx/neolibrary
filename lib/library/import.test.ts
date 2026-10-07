import { readFileSync } from "node:fs";
import { strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import { books, sections } from "@/lib/db/schema";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { ImportError } from "./ebook";
import { fileOwner, importBook } from "./import";
import { getBook, getPathView, seedPath } from "./paths";
import { epubDeclaring, epubWithEntries, tinyEpub } from "./test-epub";

const fixture = (name: string) => ({
  name,
  bytes: new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url))),
});

let database: Database;
let storage: MemoryStorage;
let ownerId: string;
beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

describe("adding the book file to a chosen title (M14 step 5)", () => {
  const titleOnly = async (owner: string, title: string) =>
    (await database.db.insert(books).values({ ownerId: owner, title, author: "Thomas S. Kuhn" }).returning())[0].id;

  it("attaches to the chosen title whatever the file's own title, keeping the list's name", async () => {
    const kuhn = await titleOnly(ownerId, "The Structure of Scientific Revolutions");
    const r = await importBook(database.db, storage, ownerId, fixture("descartes-meditation-one.pdf"), { attachTo: kuhn });
    expect(r).toMatchObject({ status: "attached", bookId: kuhn, title: "The Structure of Scientific Revolutions" });
    const { book, available } = (await getBook(database.db, ownerId, kuhn, true))!;
    expect(book).toMatchObject({ title: "The Structure of Scientific Revolutions", author: "Thomas S. Kuhn", fileType: "pdf" });
    expect(available).toEqual({ read: true, listen: false }); // a PDF: Read only
  });

  it("refuses another reader's title, a title that has its file, and an unknown id", async () => {
    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    const theirs = await titleOnly(other.id, "Their title");
    await expect(importBook(database.db, storage, ownerId, fixture("descartes-meditation-one.pdf"), { attachTo: theirs })).rejects.toThrow("not found");
    const mine = await titleOnly(ownerId, "Mine");
    await importBook(database.db, storage, ownerId, fixture("descartes-meditation-one.pdf"), { attachTo: mine });
    await expect(importBook(database.db, storage, ownerId, fixture("wells-the-time-machine.epub"), { attachTo: mine })).rejects.toThrow("already has its book file");
    await expect(importBook(database.db, storage, ownerId, fixture("wells-the-time-machine.epub"), { attachTo: "not-an-id" })).rejects.toThrow("not found");
  });

  it("fills in an author left blank when the title was typed, and keeps one that was given", async () => {
    const [blank] = await database.db.insert(books).values({ ownerId, title: "chaos", author: "" }).returning();
    await importBook(database.db, storage, ownerId, { name: "chaos.epub", bytes: tinyEpub("Chaos: Making a New Science", "James Gleick") }, { attachTo: blank.id });
    expect((await getBook(database.db, ownerId, blank.id))!.book).toMatchObject({ title: "chaos", author: "James Gleick" });
    const kuhn = await titleOnly(ownerId, "The Structure of Scientific Revolutions");
    await importBook(database.db, storage, ownerId, { name: "k.epub", bytes: tinyEpub("Structure", "Someone Else") }, { attachTo: kuhn });
    expect((await getBook(database.db, ownerId, kuhn))!.book.author).toBe("Thomas S. Kuhn");
  });

  it("refuses a deleted title and an id that is not one: nothing is stored and no book is made from the file", async () => {
    const [gone] = await database.db.insert(books).values({ ownerId, title: "Gone", deletedAt: new Date() }).returning();
    await expect(importBook(database.db, storage, ownerId, fixture("descartes-meditation-one.pdf"), { attachTo: gone.id })).rejects.toThrow("That title was not found.");
    // 36 characters that are not an id: refused in words, not by the database.
    await expect(importBook(database.db, storage, ownerId, fixture("descartes-meditation-one.pdf"), { attachTo: "-".repeat(36) })).rejects.toThrow("That title was not found.");
    expect(await database.db.select({ id: books.id, fileKey: books.fileKey }).from(books)).toEqual([{ id: gone.id, fileKey: null }]);
    expect(await storage.get(`books/${ownerId}/${gone.id}.pdf`)).toBeNull();
  });
});

describe("importing books", () => {
  it("adds an EPUB with its file, cover and contents", async () => {
    const r = await importBook(database.db, storage, ownerId, fixture("wells-the-time-machine.epub"));
    expect(r).toMatchObject({ status: "added", title: "The Time Machine" });
    const { book, available } = (await getBook(database.db, ownerId, r.bookId))!;
    expect(available.read).toBe(true);
    expect(book).toMatchObject({ author: "H. G. Wells", fileType: "epub", language: "en-GB" });
    expect(book.toc.length).toBeGreaterThan(3);
    expect((await storage.get(book.fileKey!))?.contentType).toBe("application/epub+zip");
    expect((await storage.get(book.coverKey!))?.contentType).toBe("image/svg+xml");
    expect(fileOwner(book.fileKey!)).toBe(ownerId);
  });

  it("adds a PDF without a cover", async () => {
    const r = await importBook(database.db, storage, ownerId, fixture("descartes-meditation-one.pdf"));
    const { book } = (await getBook(database.db, ownerId, r.bookId))!;
    expect(book).toMatchObject({ title: "Meditations on First Philosophy", fileType: "pdf", coverKey: null });
  });

  it("attaches a file to the title waiting for it, keeping the list's wording", async () => {
    await seedPath(database.db, ownerId, hiddenMachinery);
    const r = await importBook(database.db, storage, ownerId, {
      name: "chip-war.epub",
      bytes: tinyEpub("Chip War: The Fight for the World's Most Critical Technology", "Chris Miller"),
    });
    expect(r).toMatchObject({ status: "attached", title: "Chip War" });
    const view = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    const slot = view.pillars.find((p) => p.slug === "semiconductors")!.slots[0];
    expect(slot.book).toMatchObject({ id: r.bookId, available: { read: true }, title: "Chip War" });
    expect(view.available).toBe(1);
  });

  it("attaches a dropped file to the waiting title by the same author when two share a short title, either way round", async () => {
    await seedPath(database.db, ownerId, hiddenMachinery); // "Chip War" by Miller, waiting
    const [other] = await database.db.insert(books).values({ ownerId, title: "Chip War", author: "Ann Other" }).returning();
    const theirs = await importBook(database.db, storage, ownerId, { name: "other.epub", bytes: tinyEpub("Chip War", "Ann Other") });
    expect(theirs).toMatchObject({ status: "attached", bookId: other.id });
    const miller = await importBook(database.db, storage, ownerId, {
      name: "chip-war.epub",
      bytes: tinyEpub("Chip War: The Fight for the World's Most Critical Technology", "Chris Miller"),
    });
    expect(miller).toMatchObject({ status: "attached", title: "Chip War" });
    expect(miller.bookId).not.toBe(other.id);
    // A third author's Chip War is a book of its own, not a copy of either.
    expect(await importBook(database.db, storage, ownerId, { name: "third.epub", bytes: tinyEpub("Chip War", "Someone Else") })).toMatchObject({ status: "added" });
  });

  it("asks the reader to choose when more than one waiting title could be the file", async () => {
    await database.db.insert(books).values([
      { ownerId, title: "Poems", author: "" },
      { ownerId, title: "Poems", author: "" },
    ]);
    await expect(importBook(database.db, storage, ownerId, { name: "poems.epub", bytes: tinyEpub("Poems", "John Keats") })).rejects.toThrow(
      "More than one title waiting in your library could be this book. Open the right one and use Choose the book file.",
    );
    expect((await database.db.select({ fileKey: books.fileKey }).from(books)).every((b) => b.fileKey === null)).toBe(true);
  });

  it("reports a second copy of a book already on the shelf as a duplicate", async () => {
    const a = await importBook(database.db, storage, ownerId, fixture("shelley-frankenstein.epub"));
    const b = await importBook(database.db, storage, ownerId, fixture("shelley-frankenstein.epub"));
    expect(b).toEqual({ status: "duplicate", bookId: a.bookId, title: "Frankenstein" });
  });

  it("refuses files that are not EPUB or PDF and stores nothing", async () => {
    await expect(importBook(database.db, storage, ownerId, { name: "x.txt", bytes: strToU8("hello") })).rejects.toThrow(
      "Only EPUB and PDF",
    );
  });

  it("refuses an EPUB past either zip limit in plain words and saves nothing: no book, no file, no sections", async () => {
    const put = vi.spyOn(storage, "put");
    const [waiting] = await database.db.insert(books).values({ ownerId, title: "Big Claims", author: "" }).returning();
    const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);
    for (const [bytes, message] of [
      [epubDeclaring(512 * 1024 * 1024 + 1), "This EPUB would unpack to more than 512 MB, far more than any real book, so it was not added."],
      [epubWithEntries(10_001, "Big Claims"), "This EPUB holds more than 10,000 files, far more than any real book, so it was not added."],
    ] as const) {
      // Dropped as a new book (its title matches the waiting one), and added to the waiting title on purpose.
      for (const opts of [{}, { attachTo: waiting.id }]) {
        const e = await refusal(importBook(database.db, storage, ownerId, { name: "big.epub", bytes }, opts));
        expect(e).toBeInstanceOf(ImportError);
        expect((e as Error).message).toBe(message);
      }
    }
    expect(put).not.toHaveBeenCalled();
    expect(await database.db.select({ id: books.id, fileKey: books.fileKey }).from(books)).toEqual([{ id: waiting.id, fileKey: null }]);
    expect(await database.db.select({ id: sections.id }).from(sections)).toEqual([]);
  });

  it("adds a book of exactly 10,000 files, with its file and its sections", async () => {
    const r = await importBook(database.db, storage, ownerId, { name: "many.epub", bytes: epubWithEntries(10_000) });
    expect(r).toMatchObject({ status: "added", title: "Many Files" });
    expect((await storage.get(`books/${ownerId}/${r.bookId}.epub`))?.contentType).toBe("application/epub+zip");
    expect(await database.db.select({ text: sections.text }).from(sections)).toContainEqual({ text: "One short page." });
  });

  it("knows who owns a stored file only from well-formed keys", () => {
    expect(fileOwner("books/00000000-0000-0000-0000-000000000000/x.epub")).toBe("00000000-0000-0000-0000-000000000000");
    expect(fileOwner("other/x")).toBeNull();
  });
});
