import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage, type Storage } from "@/lib/storage";
import { withSmallFileCache } from "@/lib/storage/small-file-cache";
import { importBook } from "./import";
import { removeBook } from "./remove-book";
import { warmCovers } from "./warm-covers";

// Covers are read into the server's memory at start and kept there: a shelf's first visit after a deploy must not
// wait on the bucket (measured 2026-11-11: 31.6 s for 129 covers in Safari's engine with the memory empty, 3.2 s with it full).

let database: Database;
let ownerId: string;
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url)));

/** The storage the server uses (memory in front of the files), counting each read that reaches the files. */
function countedStorage() {
  const inner = new MemoryStorage();
  const reads: string[] = [];
  const spy: Storage = Object.assign(Object.create(inner) as Storage, {
    get: (key: string) => (reads.push(key), inner.get(key)),
    stat: (key: string) => (reads.push(key), inner.stat(key)),
    put: (key: string, data: Uint8Array, type: string) => inner.put(key, data, type),
    delete: (key: string) => inner.delete(key),
  });
  return { inner, reads, make: () => withSmallFileCache(spy) };
}

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

describe("warmCovers", () => {
  it("after a restart, one pass reads each cover once, and a visit then reads nothing from the files", async () => {
    const db = database.db;
    const files = countedStorage();
    const { bookId } = await importBook(db, files.make(), ownerId, { name: "tm.epub", bytes: fixture("wells-the-time-machine.epub") });
    const [{ coverKey }] = await db.select({ coverKey: books.coverKey }).from(books).where(eq(books.id, bookId));
    expect(coverKey, "the fixture has a cover").toBeTruthy();

    // A restart: a new, empty memory in front of the same files.
    const storage = files.make();
    files.reads.length = 0;
    expect(await warmCovers(db, storage)).toMatchObject({ covers: 1, missing: 0, leftOut: 0 });
    expect(files.reads).toEqual([coverKey]);

    // A visit (the size, then the bytes, as lib/serve-file.ts asks), and a second pass: nothing more is read.
    files.reads.length = 0;
    expect((await storage.stat(coverKey!))?.size).toBeGreaterThan(0);
    expect((await storage.get(coverKey!))?.data.byteLength).toBeGreaterThan(0);
    expect(await warmCovers(db, storage)).toMatchObject({ covers: 1, missing: 0, leftOut: 0 });
    expect(files.reads).toEqual([]);
  });

  it("stops before the memory is full, and says how many covers it left out", async () => {
    const db = database.db;
    const files = countedStorage();
    for (const name of ["wells-the-time-machine.epub", "shelley-frankenstein.epub"]) await importBook(db, files.make(), ownerId, { name, bytes: fixture(name) });
    const all = await warmCovers(db, files.make());
    expect(all).toMatchObject({ covers: 2, leftOut: 0 });
    expect(all.bytes).toBeGreaterThan(0);
    // Room for one byte only: one worker reads one cover, sees the room is used up, and stops.
    expect(await warmCovers(db, files.make(), { atOnce: 1, maxBytes: 1 })).toMatchObject({ covers: 1, leftOut: 1 });
  });

  it("leaves out a removed book's cover, and counts a cover whose file is gone without failing", async () => {
    const db = database.db;
    const files = countedStorage();
    const a = await importBook(db, files.make(), ownerId, { name: "tm.epub", bytes: fixture("wells-the-time-machine.epub") });
    const [{ coverKey }] = await db.select({ coverKey: books.coverKey }).from(books).where(eq(books.id, a.bookId));
    await files.inner.delete(coverKey!);
    expect(await warmCovers(db, files.make())).toMatchObject({ covers: 0, missing: 1, leftOut: 0 });
    await removeBook(db, ownerId, a.bookId);
    expect(await warmCovers(db, files.make())).toMatchObject({ covers: 0, missing: 0, leftOut: 0 });
  });
});
