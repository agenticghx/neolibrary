import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin, createInvite, acceptInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { getBook } from "./paths";
import { isCfi, savePosition, savePositionAt } from "./reading";

let database: Database;
let ownerId: string;
let bookId: string;
beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  bookId = (await database.db.insert(books).values({ ownerId, title: "T", fileKey: "books/x/t.epub", fileType: "epub" }).returning())[0].id;
});
afterEach(() => database.raw.close());

describe("reading position", () => {
  it("accepts well-formed CFIs only", () => {
    expect(isCfi("epubcfi(/6/4!/4/2/1:0)")).toBe(true);
    expect(isCfi("epubcfi(/6/14[chap05ref]!/4[body01]/10/2/1:3[2^[1^]])")).toBe(true);
    expect(isCfi('epubcfi(/6/4"><script>)')).toBe(false);
    expect(isCfi("epubcfi(/6/4[chapter-1]!/4/2,/1:0,/1:12)")).toBe(true);
    expect(isCfi("javascript:alert(1)")).toBe(false);
    expect(isCfi("x".repeat(600))).toBe(false);
  });

  it("saves position and progress for the owner only", async () => {
    const t = new Date("2026-10-04T10:00:00Z");
    expect(await savePosition(database.db, ownerId, bookId, { cfi: "epubcfi(/6/8!/4/2/1:0)", fraction: 0.3333 }, t)).toBe(true);
    const { book } = (await getBook(database.db, ownerId, bookId))!;
    expect(book).toMatchObject({ position: "epubcfi(/6/8!/4/2/1:0)", progress: 0.333, lastOpenedAt: t });

    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    expect(await savePosition(database.db, other.id, bookId, { cfi: "epubcfi(/6/2!/4)", fraction: 0.1 })).toBe(false);
    expect(await savePosition(database.db, ownerId, bookId, { cfi: "epubcfi(/6/2!/4)", fraction: 2 })).toBe(false);
    expect(await savePosition(database.db, ownerId, "not-a-uuid", { cfi: "epubcfi(/6/2!/4)", fraction: 0.1 })).toBe(false);
  });

  // M14 step 6b: listening away from the reader, the position follows the voice, paragraph by paragraph.
  it("saves the position at a paragraph: its CFI, and the share of the book's text before it, kept below 1", async () => {
    const rows = await database.db
      .insert(sections)
      .values(
        Array.from({ length: 4 }, (_, i) => ({
          bookId,
          // As the EPUB importer names them (sections.ts): "c-" for a chapter, "s-" for a paragraph, and a hash.
          id: i === 0 ? "c-0a1b2c3d4e" : `s-0a1b2c3d4e5${i}`,
          kind: i === 0 ? ("chapter" as const) : ("paragraph" as const),
          chapterIndex: 0,
          href: "chapter-1.xhtml",
          position: i,
          cfi: `epubcfi(/6/2!/4/${(i + 1) * 2})`,
          label: i === 0 ? "One" : "",
          text: i === 0 ? "" : `Paragraph ${i}.`,
        })),
      )
      .returning({ id: sections.id });
    const t = new Date("2026-10-06T12:00:00Z");
    expect(await savePositionAt(database.db, ownerId, bookId, rows[2].id, t)).toBe(true);
    // Three paragraphs of 12 characters (the chapter row has no text): 12 of 36 come before the second.
    expect((await getBook(database.db, ownerId, bookId))!.book).toMatchObject({ position: "epubcfi(/6/2!/4/6)", progress: 0.333, lastOpenedAt: t });
    // The last paragraph: 24 of 36 before it; below 1, so listening to it does not mark the book finished.
    expect(await savePositionAt(database.db, ownerId, bookId, rows[3].id)).toBe(true);
    expect((await getBook(database.db, ownerId, bookId))!.book.progress).toBe(0.667);

    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    expect(await savePositionAt(database.db, other.id, bookId, rows[2].id)).toBe(false);
    const elsewhere = (await database.db.insert(books).values({ ownerId, title: "U", fileKey: "books/y/u.epub", fileType: "epub" }).returning())[0].id;
    expect(await savePositionAt(database.db, ownerId, elsewhere, rows[2].id)).toBe(false);
    expect(await savePositionAt(database.db, ownerId, bookId, "s-not-in-this-book")).toBe(false);
    expect(await savePositionAt(database.db, ownerId, bookId, "s-1'; drop table books")).toBe(false);
    expect(await savePositionAt(database.db, ownerId, bookId, 42)).toBe(false);
  });

  it("in a PDF, saves the progress as the reader counts it: up to the end of the paragraph's page", async () => {
    const pdf = (await database.db.insert(books).values({ ownerId, title: "P", fileKey: "books/p/p.pdf", fileType: "pdf", pageCount: 10 }).returning())[0].id;
    await database.db.insert(sections).values({
      bookId: pdf,
      id: "p-page-4-1",
      kind: "paragraph",
      chapterIndex: 3,
      position: 7,
      href: "page-4",
      cfi: "epubcfi(/6/8)",
      label: "",
      text: "A paragraph on page 4.",
    });
    expect(await savePositionAt(database.db, ownerId, pdf, "p-page-4-1")).toBe(true);
    // Page 4 of 10 (index 3): the reader shows 40% there (foliate's fixed layout counts to the page's end).
    expect((await getBook(database.db, ownerId, pdf))!.book).toMatchObject({ position: "epubcfi(/6/8)", progress: 0.4 });
  });
});
