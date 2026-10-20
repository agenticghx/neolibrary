import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { annotations, books, generations, readingSessions } from "@/lib/db/schema";
import { partAnchor } from "./explain-back";
import { chapterFor } from "./prerequisites";
import { isCfi } from "./reading";
import { startOfDay } from "./review-schedule";

/**
 * "Where were we?" (M28 S3): coming back to a book on a later day, the reader is asked what they remember of the
 * chapter they were in. Their answer goes to Explain it back for that chapter (lib/library/explain-back.ts), so what
 * they missed comes back in Daily review. Recalling before rereading is the point: it is retrieval practice, and it
 * is spaced, since a day or more has passed.
 *
 * Asked only when all of these hold:
 * - the reader's latest sitting with this book began on an earlier day (UTC, as Daily review counts days): a sitting
 *   today means they have already read today, so it is asked at most once a day per book. Only sittings of a minute
 *   or more count (as on the reading calendar): every opening of the book records a sitting, even a glance;
 * - the book has a saved place, and that place is in a chapter (the chapter it names);
 * - the reader has not explained that chapter back already: no Explain it back answer for it, and no summary note
 *   where Explain it back puts one (the chapter's first paragraph), since the summary is kept even when Claude could
 *   not answer (no AI set up, a spending cap).
 * The page leaves it out during a focus session; Skip hides it for the day on that device.
 */
/** A sitting counts as reading from this many seconds (the reading calendar's "a day read from a full minute"). */
export const READ_SECONDS = 60;

export type WhereWereWe = { chapterId: string; label: string; lastReadAt: string };

export async function whereWereWe(db: Db, ownerId: string, bookId: string, now = new Date()): Promise<WhereWereWe | null> {
  const [last] = await db
    .select({ startedAt: readingSessions.startedAt })
    .from(readingSessions)
    .where(and(eq(readingSessions.ownerId, ownerId), eq(readingSessions.bookId, bookId), gte(readingSessions.activeSeconds, READ_SECONDS)))
    .orderBy(desc(readingSessions.startedAt))
    .limit(1);
  if (!last || last.startedAt.getTime() >= startOfDay(now).getTime()) return null;
  const [book] = await db
    .select({ position: books.position })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book?.position || !isCfi(book.position)) return null;
  const chapter = await chapterFor(db, ownerId, bookId, { cfi: book.position }).catch(() => null);
  if (!chapter) return null;
  const [explained] = await db
    .select({ id: generations.id })
    .from(generations)
    .where(and(eq(generations.ownerId, ownerId), eq(generations.bookId, bookId), eq(generations.sectionId, chapter.id), eq(generations.kind, "explain-back")))
    .limit(1);
  if (explained) return null;
  const anchor = await partAnchor(db, bookId, chapter).catch(() => null);
  if (!anchor) return null; // a chapter with no text has nothing to remember
  const [summary] = await db
    .select({ id: annotations.id })
    .from(annotations)
    .where(and(eq(annotations.ownerId, ownerId), eq(annotations.bookId, bookId), eq(annotations.kind, "note"), eq(annotations.cfi, anchor.cfi)))
    .limit(1);
  if (summary) return null;
  return { chapterId: chapter.id, label: chapter.label, lastReadAt: last.startedAt.toISOString() };
}
