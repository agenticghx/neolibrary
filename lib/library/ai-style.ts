import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, users } from "@/lib/db/schema";
import { STYLES, isStyle, type Style } from "./levels";

/**
 * The style AI explanations are written in (M6): plain English or STE at a
 * strictness. Set once per reader, and changeable per book (a book's style of
 * null follows the reader's).
 */
export class StyleError extends Error {}

export async function getStyles(db: Db, ownerId: string, bookId: string) {
  const [row] = await db
    .select({ user: users.aiStyle, book: books.aiStyle })
    .from(books)
    .innerJoin(users, eq(users.id, books.ownerId))
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!row) throw new StyleError("Book not found");
  return { user: row.user, book: row.book, effective: row.book ?? row.user };
}

/** Sets the reader's style for all books, or this book's own (null = follow the reader's). */
export async function setStyle(db: Db, ownerId: string, bookId: string, input: { scope: unknown; style: unknown }) {
  await getStyles(db, ownerId, bookId);
  if (input.scope === "all") {
    if (!isStyle(input.style)) throw new StyleError(`Choose one of: ${Object.keys(STYLES).join(", ")}.`);
    await db.update(users).set({ aiStyle: input.style }).where(eq(users.id, ownerId));
    await db.update(books).set({ aiStyle: null }).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  } else if (input.scope === "book") {
    if (input.style !== null && !isStyle(input.style)) throw new StyleError(`Choose one of: ${Object.keys(STYLES).join(", ")}.`);
    await db.update(books).set({ aiStyle: input.style as Style | null }).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  } else throw new StyleError('Scope is "all" or "book".');
  return getStyles(db, ownerId, bookId);
}
