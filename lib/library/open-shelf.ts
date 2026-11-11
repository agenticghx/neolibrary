import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, users } from "@/lib/db/schema";
import { isOwnBook } from "@/lib/library/own-book";

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
  const where = isOwnBook(bookId, ownerId);
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

/*
 * S2: what a visitor (not signed in) may see. Only the owner's books (the first
 * admin's) that are on the open shelf, and only the fields below: never the
 * owner's note, progress, place, collections or dates of reading.
 */
const VISIBLE = {
  id: books.id,
  title: books.title,
  author: books.author,
  coverKey: books.coverKey,
  description: books.description,
  publisher: books.publisher,
  language: books.language,
  pageCount: books.pageCount,
  fileType: books.fileType,
  freeToRead: books.freeToRead,
};

/** The library's owner: the first admin. The open shelf shows only their books, under their name. */
export async function shelfOwner(db: Db): Promise<{ id: string; name: string } | null> {
  const [owner] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.role, "admin"), isNull(users.disabledAt)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return owner ?? null;
}

async function shelfOwnerId(db: Db) {
  return (await shelfOwner(db))?.id ?? null;
}

const onShelf = (ownerId: string) =>
  and(eq(books.ownerId, ownerId), eq(books.onShelf, true), isNull(books.deletedAt), isNull(books.editionOf));

export const OPEN_SORTS = { title: "Title", author: "Author" } as const;
export type OpenSort = keyof typeof OPEN_SORTS;
export const parseOpenSort = (s: unknown): OpenSort => (s === "author" ? "author" : "title");

/** Every book on the open shelf, optionally searched by title or author, or only the free ones. */
export async function listOpenShelf(db: Db, opts: { q?: string; free?: boolean; sort?: OpenSort } = {}) {
  const ownerId = await shelfOwnerId(db);
  if (!ownerId) return [];
  const filters = [onShelf(ownerId)];
  const q = opts.q?.trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    filters.push(or(ilike(books.title, like), ilike(books.author, like)));
  }
  if (opts.free) filters.push(eq(books.freeToRead, true));
  const order =
    opts.sort === "author"
      ? [asc(sql`lower(${books.author})`), asc(sql`lower(${books.title})`)]
      : [asc(sql`lower(${books.title})`), asc(sql`lower(${books.author})`)];
  return db
    .select(VISIBLE)
    .from(books)
    .where(and(...filters))
    .orderBy(...order, asc(books.id));
}

/** One book on the open shelf, or null: not the owner's, off the shelf, removed, or not a book id at all. */
export async function getOpenBook(db: Db, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const ownerId = await shelfOwnerId(db);
  if (!ownerId) return null;
  const [book] = await db
    .select(VISIBLE)
    .from(books)
    .where(and(eq(books.id, id), onShelf(ownerId)));
  return book ?? null;
}

/** May a visitor have this stored file? The cover of a book on the open shelf, or the file of a book free to read. */
export async function visitorMayHave(db: Db, key: string): Promise<boolean> {
  const ownerId = await shelfOwnerId(db);
  if (!ownerId) return false;
  const [hit] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(onShelf(ownerId), or(eq(books.coverKey, key), and(eq(books.fileKey, key), eq(books.freeToRead, true)))))
    .limit(1);
  return Boolean(hit);
}

/** S3: a book a visitor may read (on the shelf and free to read, with a file), with its stored file's key; else null. */
export async function freeBookToRead(db: Db, id: string) {
  const book = await getOpenBook(db, id);
  if (!book?.freeToRead || !book.fileType) return null;
  const [file] = await db.select({ fileKey: books.fileKey }).from(books).where(eq(books.id, book.id));
  return file?.fileKey ? { ...book, fileType: book.fileType, fileKey: file.fileKey } : null;
}

/** Where a visitor can find a book that is not free to read: a Goodreads search for its title and author (Samuel, 2026-11-02). */
export function goodreadsUrl(title: string, author: string) {
  const q = [title, author].map((s) => s.trim()).filter(Boolean).join(" ");
  return `https://www.goodreads.com/search?q=${encodeURIComponent(q)}`;
}
