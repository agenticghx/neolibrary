import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { createAnnotation, deleteAnnotation, updateAnnotation } from "@/lib/library/annotations";
import { importBook } from "@/lib/library/import";
import { seedPath } from "@/lib/library/paths";
import { removeBook } from "@/lib/library/remove-book";
import { MemoryStorage } from "@/lib/storage";
import { paletteData } from "./data";

let database: Database;
let ownerId: string;
const fixture = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url))) });
const CFI = "epubcfi(/6/4!/4/2/1:0)";

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

describe("paletteData (GET /api/palette)", () => {
  it("lists books, Paths with their sections, and the newest notes in their latest wording", async () => {
    const storage = new MemoryStorage();
    const jekyll = await importBook(database.db, storage, ownerId, fixture("stevenson-jekyll-and-hyde.epub"));
    const wells = await importBook(database.db, storage, ownerId, fixture("wells-the-time-machine.epub"));
    await seedPath(database.db, ownerId, hiddenMachinery);

    const old = await createAnnotation(database.db, ownerId, { kind: "note", bookId: jekyll.bookId, cfi: CFI, body: "first wording" }, new Date("2026-10-01"));
    await updateAnnotation(database.db, ownerId, old.id, { body: "second wording" }, new Date("2026-10-02"));
    await createAnnotation(database.db, ownerId, { kind: "highlight", bookId: wells.bookId, cfi: CFI, quote: { exact: "the Time Traveller" } }, new Date("2026-10-03"));
    const gone = await createAnnotation(database.db, ownerId, { kind: "note", bookId: wells.bookId, cfi: CFI, body: "removed" }, new Date("2026-10-04"));
    await deleteAnnotation(database.db, ownerId, gone.id, new Date("2026-10-05"));
    await createAnnotation(database.db, ownerId, { kind: "bookmark", bookId: wells.bookId, cfi: CFI }, new Date("2026-10-06"));
    await createAnnotation(database.db, ownerId, { kind: "note", bookId: wells.bookId, body: "on the whole book, no place" }, new Date("2026-10-07"));

    const data = await paletteData(database.db, ownerId);
    expect(data.books.find((b) => b.id === wells.bookId)).toMatchObject({ title: "The Time Machine", hasFile: true, openedAt: null });
    // Titles waiting for their file (from the Path) are books too, with nothing to read yet.
    expect(data.books.some((b) => !b.hasFile)).toBe(true);
    const path = data.paths.find((p) => p.slug === hiddenMachinery.slug)!;
    expect(path.title).toBe(hiddenMachinery.title);
    expect(path.pillars.length).toBe(hiddenMachinery.pillars.length);
    expect(path.pillars[0].anchor).toBe(`p-${path.pillars[0].slug}`);
    // Newest first; a highlight by its quote; no removed note, bookmark, or note without a place.
    expect(data.notes.map((n) => [n.kind, n.text])).toEqual([
      ["highlight", "the Time Traveller"],
      ["note", "second wording"],
    ]);
    expect(data.notes[1]).toMatchObject({ id: old.id, bookId: jekyll.bookId, cfi: CFI });

    // A book removed from the library leaves, with its notes.
    await removeBook(database.db, ownerId, wells.bookId);
    const after = await paletteData(database.db, ownerId);
    expect(after.books.some((b) => b.id === wells.bookId)).toBe(false);
    expect(after.notes.map((n) => n.text)).toEqual(["second wording"]);
  });

  it("shows nobody else's books or notes", async () => {
    const storage = new MemoryStorage();
    const jekyll = await importBook(database.db, storage, ownerId, fixture("stevenson-jekyll-and-hyde.epub"));
    await createAnnotation(database.db, ownerId, { kind: "note", bookId: jekyll.bookId, cfi: CFI, body: "mine" });
    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    expect(await paletteData(database.db, other.id)).toEqual({ books: [], paths: [], notes: [] });
  });
});
