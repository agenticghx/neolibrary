import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, users } from "@/lib/db/schema";
import { shelfOwner } from "./open-shelf";

/**
 * Shared papers (M41 R3c, Samuel 2026-11-02: "yes people invited should see papers"). The library owner's papers are
 * shared with every invited reader: each reader gets their own row for each paper (`shared_from` names the owner's
 * row), pointing at the same file, with its own copy of the paper's sections. So the paper is in their library and
 * under Papers, and their place, highlights, notes and AI answers are their own; every check that a book is the
 * reader's own still holds. The owner turns sharing off per paper (`share_papers`); unmarking it as a paper, removing
 * it, or turning sharing off hides the readers' copies (removed, as any removed book: their notes are kept, ground
 * rule 9). Only the owner's papers are shared; a reader's own uploads stay theirs alone (ground rule 6: sharing a
 * file is the owner's deliberate choice, and Samuel made it for papers).
 */

/** The book columns a reader's copy takes from the owner's paper. */
const COPIED = {
  title: books.title,
  author: books.author,
  description: books.description,
  fileKey: books.fileKey,
  fileName: books.fileName,
  fileType: books.fileType,
  fileSize: books.fileSize,
  coverKey: books.coverKey,
  coverSource: books.coverSource,
  isbn: books.isbn,
  language: books.language,
  publisher: books.publisher,
  toc: books.toc,
  pageCount: books.pageCount,
  kind: books.kind,
  authors: books.authors,
  journal: books.journal,
  year: books.year,
  doi: books.doi,
  pmid: books.pmid,
} as const;

/** Is this the owner's paper, shared, with a file, not removed? */
async function sharedPaper(db: Db, paperId: string) {
  const owner = await shelfOwner(db);
  if (!owner) return null;
  const [p] = await db
    .select({ ...COPIED, id: books.id, ownerId: books.ownerId, sharePapers: books.sharePapers, deletedAt: books.deletedAt, sharedFrom: books.sharedFrom, editionOf: books.editionOf })
    .from(books)
    .where(eq(books.id, paperId));
  if (!p || p.ownerId !== owner.id || p.sharedFrom || p.editionOf) return { paper: null, ownerId: owner.id };
  const live = p.kind === "paper" && p.sharePapers && !p.deletedAt && !!p.fileKey;
  return { paper: live ? p : null, ownerId: owner.id };
}

/** Is the owner's paper `paperId` shared with readers at this moment? */
export async function stillShared(db: Db, paperId: string): Promise<boolean> {
  return !!(await sharedPaper(db, paperId))?.paper;
}

/** The invited readers: everyone signed up who is not the owner and not disabled. */
async function readers(db: Db, ownerId: string, only?: string) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(ne(users.id, ownerId), isNull(users.disabledAt), only ? eq(users.id, only) : undefined));
  return rows.map((r) => r.id);
}

export type ShareResult = { shared: number; hidden: number };

/**
 * Brings every reader's copy of the owner's book `paperId` in line with it: a shared paper gets a copy for each reader
 * (made, refreshed, or brought back if hidden); anything else (not a paper, sharing off, removed) hides the copies.
 * Called whenever the owner marks or unmarks a paper, turns its sharing on or off, removes or restores it.
 */
export async function syncSharedPaper(db: Db, paperId: string, onlyReader?: string): Promise<ShareResult> {
  const found = await sharedPaper(db, paperId);
  if (!found) return { shared: 0, hidden: 0 };
  const { paper, ownerId } = found;
  if (!paper) {
    const hidden = await db
      .update(books)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(books.sharedFrom, paperId), isNull(books.deletedAt)))
      .returning({ id: books.id });
    return { shared: 0, hidden: hidden.length };
  }
  // The copied columns only (not the owner's id, sharing switch or removal).
  const details = Object.fromEntries(Object.keys(COPIED).map((k) => [k, paper[k as keyof typeof COPIED]])) as { [K in keyof typeof COPIED]: (typeof paper)[K] };
  let shared = 0;
  for (const readerId of await readers(db, ownerId, onlyReader)) {
    const [copy] = await db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.ownerId, readerId), eq(books.sharedFrom, paperId)));
    if (copy) {
      // Refreshed (the owner may have changed its details) and back on the shelf if it had been hidden.
      await db.update(books).set({ ...details, deletedAt: null, updatedAt: new Date() }).where(eq(books.id, copy.id));
      continue;
    }
    const [made] = await db
      .insert(books)
      .values({ ...details, ownerId: readerId, sharedFrom: paperId, onShelf: false, freeToRead: false })
      .returning({ id: books.id });
    // Its sections, copied as they are (ids come from the file, so anchors match the owner's).
    await db.execute(sql`
      INSERT INTO sections (book_id, id, kind, parent_id, position, chapter_index, href, cfi, label, text, form)
      SELECT ${made.id}, id, kind, parent_id, position, chapter_index, href, cfi, label, text, form
      FROM sections WHERE book_id = ${paperId}`);
    shared++;
  }
  return { shared, hidden: 0 };
}

/** A new reader (an invite accepted): a copy of every paper the owner shares. */
export async function shareAllWith(db: Db, readerId: string): Promise<number> {
  const owner = await shelfOwner(db);
  if (!owner || owner.id === readerId) return 0;
  const papers = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.ownerId, owner.id), eq(books.kind, "paper"), eq(books.sharePapers, true), isNull(books.deletedAt), isNull(books.sharedFrom), isNotNull(books.fileKey)));
  let n = 0;
  for (const p of papers) n += (await syncSharedPaper(db, p.id, readerId)).shared;
  return n;
}

/** The owner turns sharing of one paper on or off. */
export async function setPaperSharing(db: Db, ownerId: string, bookId: string, on: boolean): Promise<ShareResult> {
  const [b] = await db
    .update(books)
    .set({ sharePapers: on, updatedAt: new Date() })
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId), isNull(books.sharedFrom)))
    .returning({ id: books.id });
  if (!b) throw new Error("Book not found");
  return syncSharedPaper(db, bookId);
}

/** Who shares this copy with the reader (the owner's name), or null for a book of their own. */
export async function sharedBy(db: Db, book: { sharedFrom: string | null }): Promise<string | null> {
  if (!book.sharedFrom) return null;
  const [o] = await db
    .select({ name: users.name })
    .from(books)
    .innerJoin(users, eq(users.id, books.ownerId))
    .where(eq(books.id, book.sharedFrom));
  return o?.name ?? null;
}

/**
 * May this reader fetch this stored file? Their own files (the key carries their id), and the file or cover of a
 * paper shared with them (their copy names the key).
 */
export async function readerMayFetch(db: Db, userId: string, key: string, ownKey: boolean): Promise<boolean> {
  if (ownKey) return true;
  const copies = await db
    .select({ sharedFrom: books.sharedFrom })
    .from(books)
    .where(and(eq(books.ownerId, userId), isNotNull(books.sharedFrom), isNull(books.deletedAt), or(eq(books.fileKey, key), eq(books.coverKey, key))));
  // The owner's paper must still be shared: a copy on the reader's shelf is not enough on its own.
  for (const c of copies) if (await stillShared(db, c.sharedFrom!)) return true;
  return false;
}

/** How many readers hold a live copy of each of these papers (for the owner's paper page). */
export async function copiesOf(db: Db, paperIds: string[]): Promise<Map<string, number>> {
  if (!paperIds.length) return new Map();
  const rows = await db
    .select({ from: books.sharedFrom, n: sql<number>`count(*)::int` })
    .from(books)
    .where(and(inArray(books.sharedFrom, paperIds), isNull(books.deletedAt)))
    .groupBy(books.sharedFrom);
  return new Map(rows.map((r) => [r.from!, Number(r.n)]));
}
