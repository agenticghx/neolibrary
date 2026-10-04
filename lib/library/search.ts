import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";

/**
 * Full-text search across the user's books (paragraphs and headings), using
 * Postgres' built-in text search on sections.search. Notes join in M5.
 * Query syntax is Postgres "websearch": words, "exact phrases", -excluded.
 */
export type SearchHit = {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  sectionId: string;
  cfi: string;
  chapter: string;
  /** The paragraph with matches marked: alternate plain / matched pieces. */
  snippet: { text: string; match: boolean }[];
};

// Control characters as match markers: they cannot appear in book text we
// store (whitespace is normalised), so splitting on them is safe.
const START = "\u0002";
const STOP = "\u0003";

export function splitSnippet(s: string): SearchHit["snippet"] {
  const out: SearchHit["snippet"] = [];
  for (const piece of s.split(START)) {
    const [match, rest] = piece.includes(STOP) ? piece.split(STOP) : [null, piece];
    if (match) out.push({ text: match, match: true });
    if (rest) out.push({ text: rest, match: false });
  }
  return out;
}

export async function searchLibrary(db: Db, ownerId: string, query: string, limit = 60): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const rows = await db.execute(sql`
    WITH query AS (SELECT websearch_to_tsquery('english', ${q}) AS q)
    SELECT b.id AS "bookId", b.title AS "bookTitle", b.author AS "bookAuthor",
           s.id AS "sectionId", s.cfi,
           coalesce(ch.label, '') AS chapter,
           ts_headline('english', CASE WHEN s.text = '' THEN s.label ELSE s.text END, query.q,
             ${`StartSel=${START}, StopSel=${STOP}, MaxWords=40, MinWords=18, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "`}) AS headline
    FROM sections s
    JOIN books b ON b.id = s.book_id
    JOIN query ON s.search @@ query.q
    LEFT JOIN sections ch ON ch.book_id = s.book_id AND ch.kind = 'chapter' AND ch.chapter_index = s.chapter_index
    WHERE b.owner_id = ${ownerId} AND b.deleted_at IS NULL AND s.kind <> 'chapter'
    ORDER BY ts_rank(s.search, query.q) DESC, b.title, s.position
    LIMIT ${limit}
  `);
  const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as (Omit<SearchHit, "snippet"> & {
    headline: string;
  })[];
  return list.map(({ headline, ...h }) => ({ ...h, snippet: splitSnippet(headline) }));
}
