import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { listAnnotations, type Annotation } from "./annotations";
import { audiobookBookIds } from "./listenable";

/**
 * What Home shows (M14 step 3, decisions D3 and D7 in docs/m14-home-plan.md):
 * the books to continue, the newest note in each, and the titles with
 * nothing to read or listen to yet.
 */

/** Books opened before and not finished, with a book file, newest opened first. */
export async function continueBooks(db: Db, ownerId: string, limit = 2) {
  return db
    .select()
    .from(books)
    .where(
      and(
        eq(books.ownerId, ownerId),
        isNull(books.deletedAt),
        isNotNull(books.fileKey),
        isNotNull(books.lastOpenedAt),
        lt(books.progress, 1),
      ),
    )
    .orderBy(desc(books.lastOpenedAt))
    .limit(limit);
}

/** The kinds a Continue card can show: the reader's own words, or a highlighted quote. */
const SHOWN: Annotation["kind"][] = ["note", "voice", "highlight"];

/**
 * For each book, its newest note, voice note or highlight, by when it last
 * changed (its latest version), skipping deleted ones. Books with none are
 * left out of the map. (listAnnotations sorts by reading order, not time.)
 */
export async function latestNotes(db: Db, ownerId: string, bookIds: string[]): Promise<Map<string, Annotation>> {
  const out = new Map<string, Annotation>();
  for (const bookId of bookIds) {
    let newest: Annotation | null = null;
    for (const a of await listAnnotations(db, ownerId, bookId)) {
      if (SHOWN.includes(a.kind) && (!newest || a.updatedAt > newest.updatedAt)) newest = a;
    }
    if (newest) out.set(bookId, newest);
  }
  return out;
}

/** Titles with nothing available yet: no book file and no finished uploaded audiobook (D3), by title. */
export async function notYetAvailable(db: Db, ownerId: string) {
  const rows = await db
    .select()
    .from(books)
    .where(and(eq(books.ownerId, ownerId), isNull(books.deletedAt), isNull(books.fileKey)))
    .orderBy(asc(sql`lower(${books.title})`));
  const listenable = await audiobookBookIds(
    db,
    ownerId,
    rows.map((b) => b.id),
  );
  return rows.filter((b) => !listenable.has(b.id));
}

/** Books with any of the reader's marks in them (not bookmarks), for the folded corner on a cover. */
export async function bookIdsWithNotes(db: Db, ownerId: string): Promise<Set<string>> {
  const result = await db.execute(sql`
    SELECT DISTINCT book_id AS "bookId" FROM (
      SELECT DISTINCT ON (annotation_id) book_id, kind, deleted FROM annotations
      WHERE owner_id = ${ownerId} AND book_id IS NOT NULL
      ORDER BY annotation_id, version DESC
    ) latest
    WHERE NOT deleted AND kind <> 'bookmark'
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { bookId: string }[];
  return new Set(rows.map((r) => r.bookId));
}
