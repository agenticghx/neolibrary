import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { addSampleBooks, SAMPLE_BOOKS } from "./samples";
import { listShelf } from "./shelf";

let database: Database;
let ownerId: string;
beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

describe("free sample classics", () => {
  it("adds the three books with their files, once", async () => {
    const storage = new MemoryStorage();
    expect(await addSampleBooks(database.db, storage, ownerId)).toBe(3);
    const shelf = await listShelf(database.db, ownerId, { sort: "title" });
    expect(shelf.map((b) => [b.title, b.fileType])).toEqual([
      ["Frankenstein", "epub"],
      ["The Strange Case of Dr. Jekyll and Mr. Hyde", "epub"],
      ["The Time Machine", "epub"],
    ]);
    for (const b of shelf) expect(await storage.get(b.fileKey!)).toBeTruthy();
    // Pressing the button again adds nothing.
    expect(await addSampleBooks(database.db, storage, ownerId)).toBe(0);
    expect(await listShelf(database.db, ownerId)).toHaveLength(SAMPLE_BOOKS.length);
  });
});
