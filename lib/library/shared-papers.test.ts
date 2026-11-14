import { strToU8 } from "fflate";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { FakePapers } from "@/lib/papers/fake";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, listAnnotations } from "./annotations";
import { passageFor } from "./audio";
import { importBook } from "./import";
import { clearPaper, PaperError, setPaper } from "./papers";
import { chapterFor } from "./prerequisites";
import { listRemovedBooks, removeBook, restoreBook } from "./remove-book";
import { readerMayFetch, setPaperSharing, shareAllWith, sharedBy } from "./shared-papers";
import { listShelf } from "./shelf";

// M41 R3c: the owner's papers are shared with invited readers, each with their own copy. Invented paper text.
const PAPER = "# Results\n\nSmall print is read faster under a warm lamp.\n\nThe end.\n";

let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let paperId: string;
const owner = () => ({ id: ownerId, email: "o@example.com", name: "Sam Owner", role: "admin" as const });

async function invite(email: string) {
  const { token } = await createInvite(database.db, owner());
  return (await acceptInvite(database.db, token, { email, name: email.split("@")[0], password: "long enough pw" })).id;
}
const papersOf = async (who: string) => (await listShelf(database.db, who, { show: "papers" })).map((b) => b.title);

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "Sam Owner", password: "long enough pw" })).id;
  paperId = (await importBook(database.db, storage, ownerId, { name: "lamplight.md", bytes: strToU8(PAPER) })).bookId;
});
afterEach(() => database.raw.close());

describe("shared papers (M41 R3c)", () => {
  it("gives every invited reader their own copy of a paper the owner marks, with its sections and file", async () => {
    const ann = await invite("ann@example.com");
    const bob = await invite("bob@example.com");
    expect(await papersOf(ann)).toEqual([]);
    await setPaper(database.db, new FakePapers(), ownerId, paperId, "10.5555/12345678");
    for (const r of [ann, bob]) expect(await papersOf(r)).toEqual(["Lamplight and the reading of small print"]);

    const [copy] = await database.db.select().from(books).where(and(eq(books.ownerId, ann), eq(books.sharedFrom, paperId)));
    const [orig] = await database.db.select().from(books).where(eq(books.id, paperId));
    expect(copy).toMatchObject({ kind: "paper", fileKey: orig.fileKey, author: "Wick and Keeper", journal: "J Example Stud", onShelf: false, freeToRead: false });
    const count = async (id: string) => (await database.db.select({ id: sections.id }).from(sections).where(eq(sections.bookId, id))).length;
    expect(await count(copy.id)).toBe(await count(paperId));
    expect(await sharedBy(database.db, copy)).toBe("Sam Owner");

    // The file and cover of a shared paper may be fetched by its readers; a stranger's key may not.
    expect(await readerMayFetch(database.db, ann, orig.fileKey!, false)).toBe(true);
    expect(await readerMayFetch(database.db, ann, "books/00000000-0000-4000-8000-000000000000/x.epub", false)).toBe(false);

    // Notes are the reader's own: Ann's highlight is on her copy, and not in the owner's list.
    const [para] = await database.db.select({ cfi: sections.cfi, text: sections.text }).from(sections).where(and(eq(sections.bookId, copy.id), eq(sections.kind, "paragraph")));
    await createAnnotation(database.db, ann, { kind: "highlight", bookId: copy.id, cfi: para.cfi, quote: { exact: para.text.slice(0, 20), prefix: "", suffix: "" }, color: "sage" });
    expect(await listAnnotations(database.db, ann, copy.id)).toHaveLength(1);
    expect(await listAnnotations(database.db, ownerId, paperId)).toHaveLength(0);

    // Marking again refreshes the copies; it never makes a second one.
    await setPaper(database.db, new FakePapers(), ownerId, paperId, "10.5555/12345678");
    expect((await database.db.select({ id: books.id }).from(books).where(eq(books.sharedFrom, paperId))).length).toBe(2);
  });

  it("hides the copies when sharing is turned off, the paper is unmarked or removed, and brings them back", async () => {
    const ann = await invite("ann@example.com");
    await setPaper(database.db, new FakePapers(), ownerId, paperId, "7568331");
    const [orig] = await database.db.select().from(books).where(eq(books.id, paperId));

    expect(await setPaperSharing(database.db, ownerId, paperId, false)).toEqual({ shared: 0, hidden: 1 });
    expect(await papersOf(ann)).toEqual([]);
    expect(await readerMayFetch(database.db, ann, orig.fileKey!, false)).toBe(false);
    await setPaperSharing(database.db, ownerId, paperId, true);
    expect(await papersOf(ann)).toHaveLength(1);

    await removeBook(database.db, ownerId, paperId);
    expect(await papersOf(ann)).toEqual([]);
    await restoreBook(database.db, ownerId, paperId);
    expect(await papersOf(ann)).toHaveLength(1);

    await clearPaper(database.db, ownerId, paperId);
    expect(await papersOf(ann)).toEqual([]);
  });

  // Audit 2026-11-09: a copy the reader removed came back whenever the owner marked the paper again or turned its
  // sharing off and on. The reader's removal is theirs: only they bring it back.
  it("keeps a copy the reader removed out of their library when the owner shares the paper again", async () => {
    const ann = await invite("ann@example.com");
    await setPaper(database.db, new FakePapers(), ownerId, paperId, "10.5555/12345678");
    const [copy] = await database.db.select().from(books).where(and(eq(books.ownerId, ann), eq(books.sharedFrom, paperId)));
    await removeBook(database.db, ann, copy.id);
    expect(await papersOf(ann)).toEqual([]);

    await setPaper(database.db, new FakePapers(), ownerId, paperId, "10.5555/12345678"); // marked again
    expect(await papersOf(ann)).toEqual([]);
    await setPaperSharing(database.db, ownerId, paperId, false);
    await setPaperSharing(database.db, ownerId, paperId, true); // sharing off and on
    expect(await papersOf(ann)).toEqual([]);
    await removeBook(database.db, ownerId, paperId);
    await restoreBook(database.db, ownerId, paperId); // the owner removes and restores it
    expect(await papersOf(ann)).toEqual([]);
    // Still in her removed books while it is shared, and she can bring it back herself.
    expect((await listRemovedBooks(database.db, ann)).map((b) => b.id)).toEqual([copy.id]);
    await restoreBook(database.db, ann, copy.id);
    expect(await papersOf(ann)).toHaveLength(1);
    // Brought back by her, it follows the owner's sharing again.
    await setPaperSharing(database.db, ownerId, paperId, false);
    expect(await papersOf(ann)).toEqual([]);
    await setPaperSharing(database.db, ownerId, paperId, true);
    expect(await papersOf(ann)).toHaveLength(1);
  });

  it("does not let a reader bring back a copy of a paper the owner stopped sharing", async () => {
    const ann = await invite("ann@example.com");
    await setPaper(database.db, new FakePapers(), ownerId, paperId, "10.5555/12345678");
    const [orig] = await database.db.select().from(books).where(eq(books.id, paperId));
    const [copy] = await database.db.select().from(books).where(and(eq(books.ownerId, ann), eq(books.sharedFrom, paperId)));
    await setPaperSharing(database.db, ownerId, paperId, false);
    expect(await listRemovedBooks(database.db, ann)).toEqual([]);
    await expect(restoreBook(database.db, ann, copy.id)).rejects.toThrow("Book not found.");
    expect(await papersOf(ann)).toEqual([]);
    // The hidden copy's own paragraphs are not served either (read aloud, rewrites, the X-ray, and the rest ask this way).
    await expect(passageFor(database.db, ann, copy.id, { cfi: "epubcfi(/6/2)" })).rejects.toThrow("Book not found");
    await expect(chapterFor(database.db, ann, copy.id, { cfi: "epubcfi(/6/2)" })).rejects.toThrow();
    // A copy left on a shelf by any route still opens no file once sharing is off.
    await database.db.update(books).set({ deletedAt: null }).where(eq(books.id, copy.id));
    expect(await readerMayFetch(database.db, ann, orig.fileKey!, false)).toBe(false);
    // Sharing on again: the copy and its file are back.
    await setPaperSharing(database.db, ownerId, paperId, true);
    expect(await papersOf(ann)).toHaveLength(1);
    expect(await readerMayFetch(database.db, ann, orig.fileKey!, false)).toBe(true);
  });

  it("gives a reader who joins later the papers already shared, and shares no reader's own paper", async () => {
    await setPaper(database.db, new FakePapers(), ownerId, paperId, "7568331");
    const ann = await invite("ann@example.com");
    // Accepting an invite on the site calls shareAllWith (app/(public)/actions.ts); here it is called directly.
    expect(await papersOf(ann)).toEqual([]);
    expect(await shareAllWith(database.db, ann)).toBe(1);
    expect(await papersOf(ann)).toEqual(["The search for synergy: a critical review from a response surface perspective"]);

    const bob = await invite("bob@example.com");
    const own = (await importBook(database.db, storage, ann, { name: "anns-paper.md", bytes: strToU8("# Mine\n\nAnn's own words.\n") })).bookId;
    await setPaper(database.db, new FakePapers(), ann, own, "10.5555/12345678");
    expect(await papersOf(bob)).toEqual([]);
    expect(await papersOf(ownerId)).toEqual(["The search for synergy: a critical review from a response surface perspective"]);

    // A reader cannot change a shared paper's details.
    const [copy] = await database.db.select({ id: books.id }).from(books).where(and(eq(books.ownerId, ann), eq(books.sharedFrom, paperId)));
    await expect(setPaper(database.db, new FakePapers(), ann, copy.id, "10.5555/12345678")).rejects.toThrow(
      new PaperError("This paper is shared with you; only its owner can change its details."),
    );
  });
});
