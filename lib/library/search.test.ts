import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { createAnnotation, deleteAnnotation, updateAnnotation } from "./annotations";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import { getPathView, seedPath } from "./paths";
import { searchLibrary, searchNotes, splitSnippet } from "./search";

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

  it("searches your notes: latest version only, hidden ones left out", async () => {
    const shelf = await searchLibrary(database.db, ownerId, '"rugged countenance"');
    const bookId = shelf[0].bookId;
    const n = await createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "The doppelganger motif" });
    await updateAnnotation(database.db, ownerId, n.id, { body: "The double as a motif" });
    const gone = await createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "A motif I removed" });
    await deleteAnnotation(database.db, ownerId, gone.id);
    expect(await searchNotes(database.db, ownerId, "doppelganger")).toEqual([]);
    const hits = await searchNotes(database.db, ownerId, "motif");
    expect(hits.map((h) => h.annotationId)).toEqual([n.id]);
    expect(hits[0].snippet.find((p) => p.match)?.text).toBe("motif");
  });

  it("gives a note on a pillar or a path its Path's slug, and a book note none", async () => {
    await seedPath(database.db, ownerId, hiddenMachinery);
    const view = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    await createAnnotation(database.db, ownerId, { kind: "note", targetType: "pillar", targetId: view.pillars[0].id, body: "Grid frequency drifts" });
    await createAnnotation(database.db, ownerId, { kind: "note", targetType: "path", targetId: view.id, body: "Grid systems overall" });
    const shelf = await searchLibrary(database.db, ownerId, '"rugged countenance"');
    await createAnnotation(database.db, ownerId, { kind: "note", bookId: shelf[0].bookId, body: "Grid of streets" });
    const hits = await searchNotes(database.db, ownerId, "grid");
    expect(hits.map((h) => [h.bookTitle, h.pathSlug]).sort()).toEqual(
      [
        ["Electricity & the grid", "hidden-machinery"],
        ["Hidden Machinery", "hidden-machinery"],
        [shelf[0].bookTitle, null],
      ].sort(),
    );
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
