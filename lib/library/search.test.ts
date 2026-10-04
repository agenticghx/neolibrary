import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { searchLibrary, splitSnippet } from "./search";

let database: Database;
let ownerId: string;
const fixture = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url))) });

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const storage = new MemoryStorage();
  await importBook(database.db, storage, ownerId, fixture("stevenson-jekyll-and-hyde.epub"));
  await importBook(database.db, storage, ownerId, fixture("wells-the-time-machine.epub"));
});
afterEach(() => database.raw.close());

describe("full-text search", () => {
  it("finds a phrase in a fixture book, with its chapter and the match marked", async () => {
    const hits = await searchLibrary(database.db, ownerId, '"rugged countenance"');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ bookTitle: "The Strange Case of Dr. Jekyll and Mr. Hyde", chapter: "Story of the Door" });
    expect(hits[0].cfi).toMatch(/^epubcfi\(\/6\/\d+.*!\/4/);
    expect(hits[0].snippet.filter((p) => p.match).map((p) => p.text.toLowerCase())).toEqual(["rugged", "countenance"]);
  });

  it("matches word forms across books, and excludes words with a minus", async () => {
    const travellers = await searchLibrary(database.db, ownerId, "travelling");
    expect(new Set(travellers.map((h) => h.bookTitle))).toEqual(new Set(["The Time Machine"]));
    const both = await searchLibrary(database.db, ownerId, "lawyer");
    expect(both.every((h) => h.bookTitle.startsWith("The Strange Case"))).toBe(true);
    const none = await searchLibrary(database.db, ownerId, "lawyer -utterson -lawyer");
    expect(none).toEqual([]);
    expect(await searchLibrary(database.db, ownerId, "   ")).toEqual([]);
  });

  it("only searches your own books", async () => {
    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    expect(await searchLibrary(database.db, other.id, "countenance")).toEqual([]);
  });

  it("splits marked snippets into plain and matched pieces", () => {
    expect(splitSnippet("a \u0002b\u0003 c \u0002d\u0003")).toEqual([
      { text: "a ", match: false },
      { text: "b", match: true },
      { text: " c ", match: false },
      { text: "d", match: true },
    ]);
  });
});
