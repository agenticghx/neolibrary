import { readFileSync } from "node:fs";
import { strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import { books } from "@/lib/db/schema";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { fileOwner, importBook } from "./import";
import { getBook, getPathView, seedPath } from "./paths";
import { tinyEpub } from "./test-epub";

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

  it("knows who owns a stored file only from well-formed keys", () => {
    expect(fileOwner("books/00000000-0000-0000-0000-000000000000/x.epub")).toBe("00000000-0000-0000-0000-000000000000");
    expect(fileOwner("other/x")).toBeNull();
  });
});
