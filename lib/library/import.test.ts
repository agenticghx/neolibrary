import { readFileSync } from "node:fs";
import { strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import { createFirstAdmin } from "@/lib/auth/service";
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

describe("importing books", () => {
  it("adds an EPUB with its file, cover and contents", async () => {
    const r = await importBook(database.db, storage, ownerId, fixture("wells-the-time-machine.epub"));
    expect(r).toMatchObject({ status: "added", title: "The Time Machine" });
    const { book, owned } = (await getBook(database.db, ownerId, r.bookId))!;
    expect(owned).toBe(true);
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

  it("attaches a file to the wanted book with the same title, keeping the list's wording", async () => {
    await seedPath(database.db, ownerId, hiddenMachinery);
    const r = await importBook(database.db, storage, ownerId, {
      name: "chip-war.epub",
      bytes: tinyEpub("Chip War: The Fight for the World's Most Critical Technology", "Chris Miller"),
    });
    expect(r).toMatchObject({ status: "attached", title: "Chip War" });
    const view = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    const slot = view.pillars.find((p) => p.slug === "semiconductors")!.slots[0];
    expect(slot.book).toMatchObject({ id: r.bookId, owned: true, title: "Chip War" });
    expect(view.owned).toBe(1);
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
