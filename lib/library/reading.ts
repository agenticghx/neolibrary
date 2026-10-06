import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A section's id as the importers make it: "s-" and a hash (EPUB), or "p-page-3-2" (PDF). */
const SECTION_ID = /^[a-z][a-z0-9-]{1,99}$/i;

/**
 * Saves the reading position at a paragraph (M14 step 6b): listening away
 * from the reader, the position follows the voice. The place is the
 * paragraph's own CFI (in a PDF, its page's); the progress is its place in
 * the book's sections, kept below 1, so that listening to the last
 * paragraph does not mark the book finished (only the reader's own end
 * does). Returns false if the book is not the owner's or the paragraph not
 * in it.
 */
export async function savePositionAt(db: Db, ownerId: string, bookId: string, sectionId: unknown, now = new Date()): Promise<boolean> {
  if (!UUID.test(bookId) || typeof sectionId !== "string" || !SECTION_ID.test(sectionId)) return false;
  const [at] = await db
    .select({ cfi: sections.cfi, position: sections.position })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.id, sectionId)));
  if (!at) return false;
  const [all] = await db.select({ n: count() }).from(sections).where(eq(sections.bookId, bookId));
  const n = Number(all?.n ?? 0);
  return savePosition(db, ownerId, bookId, { cfi: at.cfi, fraction: Math.min(0.999, n ? at.position / n : 0) }, now);
}
