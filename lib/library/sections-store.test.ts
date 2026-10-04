import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { sections } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { backfillSections, getSections } from "./sections-store";

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
