import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, collectionBooks, collections, readalongImports } from "@/lib/db/schema";

/** The library's books with a file: sorted, searched, filtered (M14 D5) and by collection. */
export const SORTS = {
  recent: { label: "Recently added", order: [desc(books.updatedAt)] },
  title: { label: "Title", order: [asc(sql`lower(${books.title})`)] },
  author: { label: "Author", order: [asc(sql`lower(${books.author})`), asc(sql`lower(${books.title})`)] },
  progress: { label: "Progress", order: [desc(books.progress), desc(books.lastOpenedAt)] },
} as const;
export type Sort = keyof typeof SORTS;

export function parseSort(value: unknown): Sort {
  return typeof value === "string" && Object.hasOwn(SORTS, value) ? (value as Sort) : "recent";
}

/**
 * The library's filters (M14 D5, Samuel 2026-10-05), as the sidebar names them.
 * Books is every title, in whatever forms it came (ebook, PDF, audiobook): a
 * title you read and listen to is one thing, not two (Samuel 2026-10-29), so
 * there are no separate Audiobooks and PDFs filters any more. Inside Books,
 * Has audio (`audio`) keeps the titles with an uploaded audiobook, never
 * narration alone (D1). Want to Read is automatic: everything not started
 * (never opened, no progress); its titles not available yet are listed beside
 * it by the page.
 */
export const SHOWS = {
  all: "Books",
  want: "Want to Read",
  finished: "Finished",
} as const;
export type Show = keyof typeof SHOWS;

/** The old format filters' addresses, kept so a bookmark still opens Books (and Audiobooks its Has audio). */
export const OLD_SHOWS: Record<string, { audio: boolean }> = { books: { audio: false }, pdfs: { audio: false }, audiobooks: { audio: true } };

export function parseShow(value: unknown): Show {
  return typeof value === "string" && Object.hasOwn(SHOWS, value) ? (value as Show) : "all";
}

export async function listShelf(
  db: Db,
  ownerId: string,
  opts: { sort?: Sort; q?: string; collectionId?: string | null; show?: Show; audio?: boolean } = {},
) {
  const q = opts.q?.trim().slice(0, 100);
  const filters = [eq(books.ownerId, ownerId), isNull(books.deletedAt), isNotNull(books.fileKey), isNull(books.editionOf)];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    filters.push(or(ilike(books.title, like), ilike(books.author, like))!);
  }
  if (opts.collectionId) {
    const ids = db
      .select({ id: collectionBooks.bookId })
      .from(collectionBooks)
      .innerJoin(collections, eq(collections.id, collectionBooks.collectionId))
      .where(and(eq(collections.id, opts.collectionId), eq(collections.ownerId, ownerId)));
    filters.push(inArray(books.id, ids));
  }
  switch (opts.show ?? "all") {
    case "want":
      filters.push(eq(books.progress, 0), isNull(books.lastOpenedAt));
      break;
    case "finished":
      filters.push(gte(books.progress, 1));
      break;
  }
  if (opts.audio) {
    const ready = db
      .select({ id: readalongImports.bookId })
      .from(readalongImports)
      .where(and(eq(readalongImports.ownerId, ownerId), eq(readalongImports.status, "ready")));
    filters.push(inArray(books.id, ready));
  }
  return db
    .select()
    .from(books)
    .where(and(...filters))
    .orderBy(...SORTS[opts.sort ?? "recent"].order);
}

export class CollectionError extends Error {}

export async function listCollections(db: Db, ownerId: string) {
  const rows = await db
    .select({ id: collections.id, name: collections.name, count: sql<number>`count(${books.id})::int` })
    .from(collections)
    .leftJoin(collectionBooks, eq(collectionBooks.collectionId, collections.id))
    // Only books still in the library count (a removed one, M19, keeps its place for when it comes back).
    .leftJoin(books, and(eq(books.id, collectionBooks.bookId), isNull(books.deletedAt)))
    .where(eq(collections.ownerId, ownerId))
    .groupBy(collections.id)
    .orderBy(asc(sql`lower(${collections.name})`));
  return rows;
}

export async function createCollection(db: Db, ownerId: string, name: string) {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!clean) throw new CollectionError("Give the collection a name.");
  const [row] = await db.insert(collections).values({ ownerId, name: clean }).onConflictDoNothing().returning();
  if (!row) throw new CollectionError("You already have a collection with that name.");
  return row;
}

export async function deleteCollection(db: Db, ownerId: string, id: string) {
  await db.delete(collections).where(and(eq(collections.id, id), eq(collections.ownerId, ownerId)));
}

/** Puts a book in (or takes it out of) a collection; both must belong to the user. */
export async function setInCollection(db: Db, ownerId: string, collectionId: string, bookId: string, inside: boolean) {
  const [c] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.ownerId, ownerId)));
  const [b] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!c || !b) throw new CollectionError("Not found.");
  if (inside) await db.insert(collectionBooks).values({ collectionId, bookId }).onConflictDoNothing();
  else
    await db
      .delete(collectionBooks)
      .where(and(eq(collectionBooks.collectionId, collectionId), eq(collectionBooks.bookId, bookId)));
}

export async function collectionsForBook(db: Db, ownerId: string, bookId: string) {
  const all = await listCollections(db, ownerId);
  const inside = new Set(
    (
      await db
        .select({ id: collectionBooks.collectionId })
        .from(collectionBooks)
        .where(eq(collectionBooks.bookId, bookId))
    ).map((r) => r.id),
  );
  return all.map((c) => ({ ...c, inside: inside.has(c.id) }));
}
