import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books } from "@/lib/db/schema";

/*
 * M34, the open shelf (docs/plan.md). Two switches on each of the owner's books:
 * "on the open shelf" (anyone sees the title, cover, author and description) and
 * "free to read" (anyone may open it). Only the owner sets them.
 *
 * Free to read is allowed only for a public-domain edition (ground rules 1 and 6:
 * no copyrighted book is handed out). The app cannot judge copyright, so it trusts
 * only publishers whose whole catalogue is public domain, as written in the book
 * file's own publisher field. Anything else stays sign-in only.
 */
export const PUBLIC_DOMAIN_PUBLISHERS = ["Standard Ebooks", "Project Gutenberg"] as const;

export class OpenShelfError extends Error {}

type Edition = { publisher: string | null; fileType: string | null; fileKey: string | null };

/** True when the book's file says it is a public-domain publisher's edition. */
export function isPublicDomainEdition(book: Edition) {
  if (!book.fileKey || !book.fileType) return false;
  const publisher = (book.publisher ?? "").trim().toLowerCase();
  return PUBLIC_DOMAIN_PUBLISHERS.some((p) => publisher === p.toLowerCase());
}

/** Turn one switch on or off, on one of the owner's own books. */
export async function setShelfSwitch(db: Db, ownerId: string, bookId: string, which: "onShelf" | "freeToRead", on: boolean) {
  const where = and(eq(books.id, bookId), eq(books.ownerId, ownerId), isNull(books.deletedAt));
  const [book] = await db.select().from(books).where(where);
  if (!book) throw new OpenShelfError("No such book.");
  if (which === "freeToRead" && on && !isPublicDomainEdition(book)) {
    throw new OpenShelfError(
      `Only a public-domain edition can be free to read: the book file must say its publisher is ${PUBLIC_DOMAIN_PUBLISHERS.join(" or ")}.`,
    );
  }
  // A book that is free to read is on the shelf; taking it off the shelf also stops it being free.
  const values =
    which === "onShelf" ? { onShelf: on, ...(on ? {} : { freeToRead: false }) } : { freeToRead: on, ...(on ? { onShelf: true } : {}) };
  await db.update(books).set(values).where(where);
}
