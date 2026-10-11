import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, pillars } from "@/lib/db/schema";
import { listPaths } from "@/lib/library/paths";

/**
 * What the command palette (M21) can jump to, for one reader: GET /api/palette sends this.
 * Kept light: titles and ids only, and the newest notes' text, cut short.
 */
export type PaletteData = {
  books: { id: string; title: string; author: string; hasFile: boolean; openedAt: string | null }[];
  /** `anchor`: the element id on the Path page (PathView: `p-<slug>`, or `master-key` for the master key). */
  paths: { slug: string; title: string; pillars: { slug: string; title: string; anchor: string }[] }[];
  /** The newest highlights, notes and voice notes at a place in a book, newest first. */
  notes: { id: string; bookId: string; cfi: string; text: string; kind: "highlight" | "note" | "voice" }[];
};

export const PALETTE_NOTES = 50;
/** Longer note texts are cut: the palette shows one line, and matches only the start. */
const NOTE_CHARS = 300;

export async function paletteData(db: Db, ownerId: string): Promise<PaletteData> {
  const [bookRows, pathRows, noteRows] = await Promise.all([
    db
      .select({ id: books.id, title: books.title, author: books.author, fileKey: books.fileKey, lastOpenedAt: books.lastOpenedAt })
      .from(books)
      .where(and(eq(books.ownerId, ownerId), isNull(books.deletedAt)))
      .orderBy(asc(sql`lower(${books.title})`)),
    listPaths(db, ownerId),
    // The latest version of each annotation (nothing is overwritten, ground rule 9), not removed, on a book
    // still in the library, with words to find it by. Bookmarks, stickers, drawings and pictures have none.
    db.execute(sql`
      SELECT a.annotation_id AS id, a.book_id AS "bookId", a.cfi, a.kind,
             left(coalesce(nullif(trim(a.body || ' ' || a.transcript), ''), a.quote_exact), ${NOTE_CHARS}) AS text
      FROM (
        SELECT DISTINCT ON (annotation_id) * FROM annotations
        WHERE owner_id = ${ownerId}
        ORDER BY annotation_id, version DESC
      ) a
      JOIN books b ON b.id = a.book_id AND b.deleted_at IS NULL
      WHERE NOT a.deleted AND a.cfi IS NOT NULL AND a.kind IN ('highlight', 'note', 'voice')
        AND trim(a.body || a.transcript || a.quote_exact) <> ''
      ORDER BY a.created_at DESC
      LIMIT ${PALETTE_NOTES}
    `),
  ]);
  const pillarRows = pathRows.length
    ? await db
        .select({ pathId: pillars.pathId, slug: pillars.slug, title: pillars.title, group: pillars.group })
        .from(pillars)
        .where(
          inArray(
            pillars.pathId,
            pathRows.map((p) => p.id),
          ),
        )
        .orderBy(asc(pillars.position))
    : [];
  const notes = (Array.isArray(noteRows) ? noteRows : (noteRows as { rows: unknown[] }).rows) as PaletteData["notes"];
  return {
    books: bookRows.map((b) => ({ id: b.id, title: b.title, author: b.author, hasFile: b.fileKey !== null, openedAt: b.lastOpenedAt?.toISOString() ?? null })),
    paths: pathRows.map((p) => ({
      slug: p.slug,
      title: p.title,
      pillars: pillarRows
        .filter((x) => x.pathId === p.id)
        .map((x) => ({ slug: x.slug, title: x.title, anchor: x.group === "master" ? "master-key" : `p-${x.slug}` })),
    })),
    notes: notes.map((n) => ({ ...n, text: n.text.replace(/\s+/g, " ").trim() })),
  };
}
