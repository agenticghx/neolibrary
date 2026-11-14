import { stillShared, syncSharedPaper } from "./shared-papers";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, paths, pillars, slots } from "@/lib/db/schema";
import { isOwnBook } from "@/lib/library/own-book";

/**
 * Removing a book from the library (M19 P3b, the site review's third finding). A removed book leaves every shelf,
 * search, collection count and per-book statistic; its file, notes and reading history are kept (ground rule 9),
 * and Your data brings it back. Nothing deletes it automatically. A book that fills a title on a Path is not removed
 * this way: it is part of that Path (Samuel's call; the default is that it stays).
 */
export class RemoveBookError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Paths a book fills a title on (their names), or none. */
export async function pathsOfBook(db: Db, ownerId: string, bookId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ title: paths.title })
    .from(slots)
    .innerJoin(pillars, eq(pillars.id, slots.pillarId))
    .innerJoin(paths, eq(paths.id, pillars.pathId))
    .where(and(eq(slots.bookId, bookId), eq(paths.ownerId, ownerId)));
  return rows.map((r) => r.title);
}

export async function removeBook(db: Db, ownerId: string, bookId: string, now = new Date()) {
  if (!UUID.test(bookId)) throw new RemoveBookError("Book not found.");
  const [book] = await db
    .select({ id: books.id, fileKey: books.fileKey })
    .from(books)
    .where(isOwnBook(bookId, ownerId));
  if (!book) throw new RemoveBookError("Book not found.");
  if (!book.fileKey) throw new RemoveBookError("A title without its book file is removed from its Path instead.");
  const onPaths = await pathsOfBook(db, ownerId, bookId);
  if (onPaths.length) throw new RemoveBookError(`This book is part of ${onPaths.join(" and ")}, so it stays in your library.`);
  await db.update(books).set({ deletedAt: now, removedByReader: true }).where(eq(books.id, bookId));
  // A scanned book's text edition leaves with it (audit 2026-11-09: it stayed live, searched inside, reviewed and counted).
  await db
    .update(books)
    .set({ deletedAt: now })
    .where(and(eq(books.editionOf, bookId), eq(books.ownerId, ownerId), isNull(books.deletedAt)));
  // M41 R3c: an owner's shared paper leaves the readers' libraries too (nothing happens for any other book).
  await syncSharedPaper(db, bookId);
}

export async function restoreBook(db: Db, ownerId: string, bookId: string) {
  if (!UUID.test(bookId)) throw new RemoveBookError("Book not found.");
  // A reader's copy of a shared paper comes back only while the owner still shares that paper.
  const [copy] = await db.select({ sharedFrom: books.sharedFrom }).from(books).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (copy?.sharedFrom && !(await stillShared(db, copy.sharedFrom))) throw new RemoveBookError("Book not found.");
  const done = await db
    .update(books)
    .set({ deletedAt: null, removedByReader: false })
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId), isNotNull(books.deletedAt), isNotNull(books.fileKey)))
    .returning({ id: books.id });
  if (!done.length) throw new RemoveBookError("Book not found.");
  await restoreEditions(db, ownerId, bookId);
  await syncSharedPaper(db, bookId);
}

/** A scanned book's text edition comes back with it (here, and when its file is uploaded again). */
export async function restoreEditions(db: Db, ownerId: string, bookId: string) {
  await db
    .update(books)
    .set({ deletedAt: null })
    .where(and(eq(books.editionOf, bookId), eq(books.ownerId, ownerId), isNotNull(books.deletedAt)));
}

/** The reader's removed books, newest removal first. Titles taken off a Path (no file) are not listed: they were never on a shelf. */
export async function listRemovedBooks(db: Db, ownerId: string) {
  const rows = await db
    .select({ id: books.id, title: books.title, author: books.author, removedAt: books.deletedAt, sharedFrom: books.sharedFrom })
    .from(books)
    .where(and(eq(books.ownerId, ownerId), isNotNull(books.deletedAt), isNotNull(books.fileKey), isNull(books.editionOf)))
    .orderBy(desc(books.deletedAt));
  const listed = [];
  for (const { sharedFrom, ...r } of rows) {
    // A copy of a paper the owner no longer shares cannot be brought back, so it is not offered.
    if (sharedFrom && !(await stillShared(db, sharedFrom))) continue;
    listed.push({ ...r, removedAt: r.removedAt!.toISOString() });
  }
  return listed;
}
