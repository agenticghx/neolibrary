import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books } from "@/lib/db/schema";

/** An EPUB CFI looks like epubcfi(/6/4!/4/2/1:0). Stored as text, never interpreted by the server. */
export function isCfi(value: unknown): value is string {
  return typeof value === "string" && value.length <= 500 && /^epubcfi\(\/[^<>"'\s]*\)$/.test(value);
}

/**
 * Saves the reading position (CFI) and progress (0–1) for the owner's book.
 * Returns false if the book is not theirs, has no file, or the input is bad.
 */
export async function savePosition(
  db: Db,
  ownerId: string,
  bookId: string,
  input: { cfi?: unknown; fraction?: unknown },
  now = new Date(),
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(bookId) || !isCfi(input.cfi)) return false;
  const fraction = Number(input.fraction);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return false;
  const rows = await db
    .update(books)
    .set({ position: input.cfi, progress: Math.round(fraction * 1000) / 1000, lastOpenedAt: now })
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId), isNull(books.deletedAt), isNotNull(books.fileKey)))
    .returning({ id: books.id });
  return rows.length === 1;
}
