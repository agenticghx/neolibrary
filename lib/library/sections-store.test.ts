import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { appSettings, books, sections } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { backfillSections, getSections, NO_PARAGRAPHS } from "./sections-store";

let database: Database;
let ownerId: string;
const file = () => ({ name: "j.epub", bytes: new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url))) });

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

describe("stored sections", () => {
  it("are built at upload, stay the same when rebuilt, and are backfilled for older books", async () => {
    const storage = new MemoryStorage();
    const { bookId } = await importBook(database.db, storage, ownerId, file());
    const first = await getSections(database.db, ownerId, bookId);
    expect(first.length).toBeGreaterThan(200);

    // Simulate a book uploaded before sections existed, then backfill.
    await database.db.delete(sections);
    expect(await getSections(database.db, ownerId, bookId)).toEqual([]);
    expect(await backfillSections(database.db, storage)).toBe(1);
    const rebuilt = await getSections(database.db, ownerId, bookId);
    expect(rebuilt.map((s) => s.id)).toEqual(first.map((s) => s.id));
    expect(await backfillSections(database.db, storage)).toBe(0);
  });
});

describe("the start-up pass for books without paragraphs (audit 2026-11-09)", () => {
  it("reads a file with no text in it once, not at every start, and again once the book has a new file", async () => {
    // A page with a drawn box and no words, like a scanned book before its text edition.
    const { PDFDocument, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]).drawRectangle({ x: 72, y: 72, width: 200, height: 300, color: rgb(0.5, 0.5, 0.5) });
    const storage = new MemoryStorage();
    const { bookId } = await importBook(database.db, storage, ownerId, { name: "scan.pdf", bytes: await pdf.save() });
    expect(await getSections(database.db, ownerId, bookId)).toEqual([]);

    const reads: string[] = [];
    const get = storage.get.bind(storage);
    storage.get = async (key: string) => {
      reads.push(key);
      return get(key);
    };
    expect(await backfillSections(database.db, storage)).toBe(0);
    expect(await backfillSections(database.db, storage)).toBe(0); // the next start
    expect(reads.filter((k) => !k.includes("cover"))).toHaveLength(1);
    // Remembered by its file, and not written again when nothing changed.
    const remembered = async () => (await database.db.select().from(appSettings).where(eq(appSettings.name, NO_PARAGRAPHS)))[0];
    const before = await remembered();
    expect(Object.keys(before.value)).toEqual([bookId]);
    await backfillSections(database.db, storage);
    expect((await remembered()).updatedAt).toEqual(before.updatedAt);

    // The same book given another file (a new key) is read again.
    const [book] = await database.db.select({ fileKey: books.fileKey }).from(books).where(eq(books.id, bookId));
    const newKey = book.fileKey!.replace(/\.pdf$/, "-2.pdf");
    await storage.put(newKey, (await get(book.fileKey!))!.data, "application/pdf");
    await database.db.update(books).set({ fileKey: newKey }).where(eq(books.id, bookId));
    await backfillSections(database.db, storage);
    expect(reads.filter((k) => !k.includes("cover"))).toEqual([book.fileKey, newKey]);
  });
});
