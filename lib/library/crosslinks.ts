import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";

/**
 * Cross-book links (M6): when the page being read covers an idea the reader
 * highlighted or noted in another book, say so ("you highlighted this idea in
 * The Time Machine, ch. 4"). No AI: Postgres reduces both texts to word stems
 * (English, without common words) and a highlight matches when it shares
 * enough of its stems with the page.
 */
export type CrossLink = {
  annotationId: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  chapter: string;
  cfi: string;
  quote: string;
  note: string;
  /** How many of the highlight's word stems the page shares. */
  shared: number;
};

const MAX_TEXT = 20_000;

/** A highlight matches if it shares at least two stems, and at least a third of its first nine. */
export function isMatch(shared: number, total: number) {
  return shared >= 2 && shared >= Math.ceil(Math.min(total, 9) / 3);
}

export async function crossLinks(db: Db, ownerId: string, bookId: string, text: string, limit = 5): Promise<CrossLink[]> {
  const page = text.slice(0, MAX_TEXT);
  if (!page.trim()) return [];
  const rows = await db.execute(sql`
    WITH page AS (SELECT tsvector_to_array(to_tsvector('english', ${page})) AS stems),
    latest AS (
      SELECT DISTINCT ON (annotation_id) * FROM annotations
      WHERE owner_id = ${ownerId} AND target_type = 'passage'
      ORDER BY annotation_id, version DESC
    ),
    candidates AS (
      SELECT a.annotation_id, a.book_id, a.section_id, a.cfi, a.quote_exact, a.body, a.created_at,
             tsvector_to_array(to_tsvector('english', a.quote_exact || ' ' || a.body)) AS stems
      FROM latest a
      JOIN books b ON b.id = a.book_id
      WHERE NOT a.deleted AND a.cfi IS NOT NULL AND a.book_id <> ${bookId}
        AND b.owner_id = ${ownerId} AND b.deleted_at IS NULL
    )
    SELECT c.annotation_id AS "annotationId", b.id AS "bookId", b.title AS "bookTitle", b.author AS "bookAuthor",
           coalesce(ch.label, '') AS chapter, c.cfi, c.quote_exact AS quote, c.body AS note,
           cardinality(c.stems) AS total,
           (SELECT count(*) FROM unnest(c.stems) s WHERE s = ANY (page.stems))::int AS shared
    FROM candidates c
    CROSS JOIN page
    JOIN books b ON b.id = c.book_id
    LEFT JOIN sections s ON s.book_id = c.book_id AND s.id = c.section_id
    LEFT JOIN sections ch ON ch.book_id = c.book_id AND ch.kind = 'chapter' AND ch.chapter_index = s.chapter_index
    WHERE c.stems && page.stems
    ORDER BY shared DESC, c.created_at DESC
  `);
  const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as (CrossLink & { total: number })[];
  return list
    .filter((r) => isMatch(r.shared, r.total))
    .slice(0, limit)
    .map((r) => ({
      annotationId: r.annotationId,
      bookId: r.bookId,
      bookTitle: r.bookTitle,
      bookAuthor: r.bookAuthor,
      chapter: r.chapter,
      cfi: r.cfi,
      quote: r.quote,
      note: r.note,
      shared: r.shared,
    }));
}
