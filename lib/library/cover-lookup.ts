import { createHash } from "node:crypto";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { checkCover } from "@/lib/covers/image";
import { normalize, surnameOf } from "@/lib/covers/match";
import { CoverSourceError, type CoverCandidate, type CoverSource } from "@/lib/covers/sources";
import type { Db } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import type { Storage } from "@/lib/storage";

/**
 * Covers for titles (M22), found in public catalogues by title and author when
 * the title has none: a title waiting on a Path, or a PDF without a cover.
 * The picture is checked, stored in the bucket under its own name, and the
 * book records where it came from. A cover inside the book's file always wins
 * (lib/library/import.ts); the reader can turn a found cover down, and it is
 * never offered again.
 */

export class CoverError extends Error {}

/**
 * A found cover's name: never the same as a cover from the book file (covers/<owner>/<book>.<ext>), and different
 * for each picture (from its address), so a replacement is never mistaken for the cover it replaced.
 */
export const foundCoverKey = (ownerId: string, bookId: string, imageUrl: string, ext: string) =>
  `covers/${ownerId}/${bookId}-found-${createHash("sha256").update(imageUrl).digest("hex").slice(0, 10)}.${ext}`;

/** A title the catalogues said nothing about is asked again after this many days (catalogues grow). */
export const RECHECK_DAYS = 30;

/** At most this many candidates are downloaded for one title. */
const MAX_TRIES = 4;

type Wanted = { id: string; ownerId: string; title: string; author: string; coverRejected: string[] };
type Picked = { candidate: CoverCandidate; image: { data: Uint8Array; contentType: string; ext: string }; isbn: string | null };

/** The first candidate whose picture passes the checks, skipping the ones this reader turned down. */
async function pick(source: CoverSource, candidates: CoverCandidate[], rejected: string[]): Promise<Picked | null> {
  let tries = 0;
  for (const candidate of candidates) {
    if (rejected.includes(candidate.imageUrl)) continue;
    if (tries++ >= MAX_TRIES) break;
    const data = await source.download(candidate);
    if (!data) continue;
    const image = checkCover(data);
    if ("refused" in image) continue;
    return { candidate, image, isbn: candidate.isbn ?? (await source.isbnOf(candidate)) };
  }
  return null;
}

/** Stores the picture and records it on the book, unless a cover arrived meanwhile (a book file with its own). */
async function keep(db: Db, storage: Storage, book: Wanted, p: Picked, now: Date): Promise<boolean> {
  const key = foundCoverKey(book.ownerId, book.id, p.candidate.imageUrl, p.image.ext);
  await storage.put(key, p.image.data, p.image.contentType);
  const done = await db
    .update(books)
    .set({
      coverKey: key,
      coverSource: p.candidate.source,
      coverRef: p.candidate.imageUrl,
      coverPage: p.candidate.pageUrl,
      ...(p.isbn ? { isbn: p.isbn } : {}),
      coverCheckedAt: now,
    })
    .where(and(eq(books.id, book.id), isNull(books.coverKey)))
    .returning({ id: books.id });
  if (!done.length) await storage.delete(key);
  return done.length > 0;
}

const markChecked = (db: Db, id: string, now: Date) => db.update(books).set({ coverCheckedAt: now }).where(eq(books.id, id));

/** Same title and surname: the same answer from the catalogues (the two readers' Hidden Machinery lists). */
const memoKey = (b: { title: string; author: string }) => `${normalize(b.title)}|${normalize(surnameOf(b.author))}`;

export type LookupProgress = { done: number; total: number; found: number };
export type LookupResult = LookupProgress & { failed: number; stopped: boolean };

/**
 * Looks up covers for titles that have none: every reader's, or one reader's (`ownerId`). A title asked about in
 * the last RECHECK_DAYS is skipped unless `force`. One title at a time, at the catalogues' pace (sources.ts). A
 * catalogue that cannot be reached three times in a row stops the run; those titles are asked again next time.
 */
export async function findMissingCovers(
  db: Db,
  storage: Storage,
  source: CoverSource,
  opts: { ownerId?: string; force?: boolean; now?: () => Date; onProgress?: (p: LookupProgress) => void; limit?: number } = {},
): Promise<LookupResult> {
  const now = opts.now ?? (() => new Date());
  const stale = new Date(now().getTime() - RECHECK_DAYS * 86_400_000);
  const wanted = await db
    .select({ id: books.id, ownerId: books.ownerId, title: books.title, author: books.author, coverRejected: books.coverRejected })
    .from(books)
    .where(
      and(
        isNull(books.coverKey),
        isNull(books.deletedAt),
        opts.ownerId ? eq(books.ownerId, opts.ownerId) : undefined,
        opts.force ? undefined : or(isNull(books.coverCheckedAt), lt(books.coverCheckedAt, stale)),
      ),
    )
    .orderBy(asc(books.ownerId), asc(books.createdAt))
    .limit(opts.limit ?? 10_000);
  const memo = new Map<string, Picked | null>();
  const result: LookupResult = { done: 0, total: wanted.length, found: 0, failed: 0, stopped: false };
  let unreachable = 0;
  for (const book of wanted) {
    try {
      const k = memoKey(book);
      let p = memo.get(k);
      if (p === undefined || (p && book.coverRejected.includes(p.candidate.imageUrl))) {
        p = await pick(source, await source.find(book), book.coverRejected);
        memo.set(k, p);
      }
      if (p && (await keep(db, storage, book, p, now()))) result.found++;
      else if (!p) await markChecked(db, book.id, now());
      unreachable = 0;
    } catch (e) {
      result.failed++;
      if (!(e instanceof CoverSourceError)) console.error(`Cover lookup failed for "${book.title}"`, e);
      else if (++unreachable >= 3) {
        result.stopped = true;
        console.error(`Cover lookup stopped: ${e.message}`);
        break;
      }
    }
    result.done++;
    opts.onProgress?.({ done: result.done, total: result.total, found: result.found });
  }
  return result;
}

const FOUND = ["openlibrary", "googlebooks", "fake"] as const;

/**
 * "Not this cover": the found cover is removed and never offered again for this title; the next match, if any,
 * takes its place at once. A cover that came with the book's file is not the catalogues' to take back.
 */
export async function rejectCover(
  db: Db,
  storage: Storage,
  source: CoverSource,
  ownerId: string,
  bookId: string,
  now: () => Date = () => new Date(),
): Promise<"replaced" | "cleared"> {
  const [book] = /^[0-9a-f-]{36}$/i.test(bookId)
    ? await db
        .select()
        .from(books)
        .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)))
    : [];
  if (!book) throw new CoverError("Book not found.");
  if (!book.coverKey || !book.coverRef || !FOUND.includes(book.coverSource as (typeof FOUND)[number])) {
    throw new CoverError("This cover came with the book's file, or there is none to turn down.");
  }
  const rejected = [...book.coverRejected, book.coverRef];
  await db
    .update(books)
    .set({ coverKey: null, coverSource: null, coverRef: null, coverPage: null, coverRejected: rejected, coverCheckedAt: now() })
    .where(eq(books.id, book.id));
  await storage.delete(book.coverKey);
  const p = await pick(source, await source.find(book), rejected);
  if (p && (await keep(db, storage, { ...book, coverRejected: rejected }, p, now()))) return "replaced";
  return "cleared";
}

/** How many of a reader's titles have a found cover, and how many still have none (for the page that lists them). */
export async function coverCounts(db: Db, ownerId: string) {
  const [row] = await db
    .select({
      found: sql<number>`count(*) filter (where ${books.coverSource} in ('openlibrary', 'googlebooks', 'fake'))`.mapWith(Number),
      none: sql<number>`count(*) filter (where ${books.coverKey} is null)`.mapWith(Number),
    })
    .from(books)
    .where(and(eq(books.ownerId, ownerId), isNull(books.deletedAt)));
  return row ?? { found: 0, none: 0 };
}
