import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, deleteAnnotation, updateAnnotation } from "./annotations";
import { crossLinks, isMatch } from "./crosslinks";
import { importBook } from "./import";
import { getSections } from "./sections-store";

let database: Database;
let ownerId: string;
let jekyll: string;
let frankenstein: string;

const load = (f: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${f}`, import.meta.url)));

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const storage = new MemoryStorage();
  jekyll = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: load("stevenson-jekyll-and-hyde.epub") })).bookId;
  frankenstein = (await importBook(database.db, storage, ownerId, { name: "f.epub", bytes: load("shelley-frankenstein.epub") })).bookId;
});
afterEach(() => database.raw.close());

/** Highlights a paragraph's opening words in a book. */
async function highlight(bookId: string, find: (text: string) => boolean, words: number, body = "") {
  const p = (await getSections(database.db, ownerId, bookId)).find((s) => s.kind === "paragraph" && find(s.text))!;
  const exact = p.text.split(" ").slice(0, words).join(" ");
  return createAnnotation(database.db, ownerId, { kind: body ? "note" : "highlight", bookId, cfi: p.cfi.replace(/\)$/, "/1:0)"), quote: { exact }, body });
}

describe("cross-book links (M6)", () => {
  it("finds a highlight in another book that shares the page's ideas, with its book, chapter and place", async () => {
    const note = await highlight(frankenstein, (t) => t.includes("You will rejoice to hear"), 8, "A will, a lawyer and a locked safe, as with Utterson.");
    const page = "Mr. Utterson the lawyer opened his safe and took out the will, which he read with a clouded brow.";
    const links = await crossLinks(database.db, ownerId, jekyll, page);
    expect(links).toEqual([
      expect.objectContaining({
        annotationId: note.id,
        bookId: frankenstein,
        bookTitle: "Frankenstein",
        cfi: note.cfi,
        quote: note.quote.exact,
        note: "A will, a lawyer and a locked safe, as with Utterson.",
      }),
    ]);
    expect(links[0].shared).toBe(3); // utterson, lawyer, safe ("will" is a common word Postgres leaves out)
    expect(links[0].chapter).not.toBe("");
  });

  it("ignores the same book, weak overlaps, hidden highlights, and uses the latest version", async () => {
    // In the same book: not a cross-book link.
    await highlight(jekyll, (t) => t.includes("lawyer"), 10, "Utterson the lawyer and the will.");
    const weak = await highlight(frankenstein, (t) => t.includes("You will rejoice to hear"), 8, "Only one shared word: lawyer.");
    const page = "Mr. Utterson the lawyer opened his safe and took out the will.";
    expect(await crossLinks(database.db, ownerId, jekyll, page)).toEqual([]);

    // An edit that adds shared ideas makes it match; hiding it removes it again.
    await updateAnnotation(database.db, ownerId, weak.id, { body: "Utterson, a lawyer, reads a will kept in his safe." });
    expect((await crossLinks(database.db, ownerId, jekyll, page)).map((l) => l.annotationId)).toEqual([weak.id]);
    await deleteAnnotation(database.db, ownerId, weak.id);
    expect(await crossLinks(database.db, ownerId, jekyll, page)).toEqual([]);
    expect(await crossLinks(database.db, ownerId, jekyll, "   ")).toEqual([]);
  });

  it("needs at least two shared stems and a third of the highlight's first nine", () => {
    expect([isMatch(1, 1), isMatch(2, 2), isMatch(2, 6), isMatch(2, 7), isMatch(3, 7), isMatch(3, 20), isMatch(2, 20)]).toEqual([
      false,
      true,
      true,
      false,
      true,
      true,
      false,
    ]);
  });
});
