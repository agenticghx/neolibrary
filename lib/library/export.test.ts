import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { readFileSync } from "node:fs";
import { exportLibrary, importLibrary, wipeLibrary } from "./export";
import { importBook } from "./import";
import { seedPath } from "./paths";
import { createCollection, listShelf, setInCollection } from "./shelf";

let database: Database;
let ownerId: string;
beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

const strip = (e: Awaited<ReturnType<typeof exportLibrary>>) => ({ ...e, exportedAt: "" });

describe("library export (ground rule 7)", () => {
  it("export → wipe → import gives back an identical library", async () => {
    const storage = new MemoryStorage();
    await seedPath(database.db, ownerId, hiddenMachinery);
    const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/wells-the-time-machine.epub", import.meta.url)));
    const { bookId } = await importBook(database.db, storage, ownerId, { name: "tm.epub", bytes: file });
    const c = await createCollection(database.db, ownerId, "Time travel");
    await setInCollection(database.db, ownerId, c.id, bookId, true);

    const before = await exportLibrary(database.db, ownerId);
    expect(before.books.length).toBeGreaterThan(100);
    expect(before.paths[0].pillars.length).toBe(hiddenMachinery.pillars.length);
    expect(before.collections).toEqual([expect.objectContaining({ name: "Time travel", bookIds: [bookId] })]);

    await wipeLibrary(database.db, ownerId);
    const empty = await exportLibrary(database.db, ownerId);
    expect([empty.books, empty.paths, empty.collections]).toEqual([[], [], []]);

    await importLibrary(database.db, ownerId, JSON.parse(JSON.stringify(before)));
    expect(strip(await exportLibrary(database.db, ownerId))).toEqual(strip(before));
    expect((await listShelf(database.db, ownerId, { collectionId: c.id })).map((b) => b.title)).toEqual(["The Time Machine"]);
  });

  it("refuses files that are not a library export", async () => {
    await expect(importLibrary(database.db, ownerId, { hello: 1 })).rejects.toThrow("not a Neolibrary library export");
    await expect(
      importLibrary(database.db, ownerId, { format: "neolibrary-library", version: 99, books: [], paths: [], collections: [] }),
    ).rejects.toThrow("newer version");
  });
});
