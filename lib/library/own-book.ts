import { and, eq, isNull } from "drizzle-orm";
import { books } from "@/lib/db/schema";

/**
 * "This book, of this reader, and not removed": the condition for looking up one book on a reader's behalf.
 *
 * Written once, here, because it was written by hand in dozens of places and the third part was forgotten in
 * fourteen of them (#324: a removed book still served its paragraphs). Use it in every `.where(...)` that finds one
 * book for its owner; add further conditions around it with `and(isOwnBook(bookId, ownerId), ...)`.
 *
 * It is about ownership only. A visitor on the open shelf, a paper shared by another reader, and the rule that a
 * copy of a shared paper is hidden once its sharing is withdrawn (lib/library/shared-papers.ts) are decided elsewhere.
 * A lookup that must also find removed books (restoring one, deleting one for good) says so by writing its own
 * condition, and is listed in lib/library/own-book.test.ts.
 */
export const isOwnBook = (bookId: string, ownerId: string) => and(eq(books.id, bookId), eq(books.ownerId, ownerId), isNull(books.deletedAt));
