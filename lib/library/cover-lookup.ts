import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { checkCover } from "@/lib/covers/image";
import { normalize, surnameOf } from "@/lib/covers/match";
import { candidateOfChoice, CoverSourceError, CoverSources, type CoverCandidate, type CoverChoice, type CoverSource } from "@/lib/covers/sources";
import type { Db } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import type { Storage } from "@/lib/storage";

/**
 * Covers for titles (M22), found in public catalogues by title and author when
 * the title has none: a title waiting on a Path, or a PDF without a cover.
 * The picture is checked, stored in the bucket under its own name, and the
 * book records where it came from. A cover inside the book's file always wins
 * (lib/library/import.ts); the reader can turn a found cover down, and it is
 * never offered again, choose one by hand from their own search (C3a), or
 * upload their own picture (C3b).
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
        isNull(books.editionOf),
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
/** Covers the reader can turn down or replace: the catalogues' and their own picture; never the book file's. */
const REPLACEABLE = [...FOUND, "upload"] as const;

/**
 * "Not this cover": the found cover is removed and never offered again for this title; the next match, if any,
 * takes its place at once. The reader's own picture (C3b) is removed the same way. A cover that came with the
 * book's file is not the catalogues' to take back.
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
  if (!book.coverKey || !REPLACEABLE.includes(book.coverSource as (typeof REPLACEABLE)[number])) {
    throw new CoverError("This cover came with the book's file, or there is none to turn down.");
  }
  // A catalogue's picture is never offered again; the reader's own has no address to remember.
  const rejected = book.coverRef ? [...book.coverRejected, book.coverRef] : book.coverRejected;
  await db
    .update(books)
    .set({ coverKey: null, coverSource: null, coverRef: null, coverPage: null, coverRejected: rejected, coverCheckedAt: now() })
    .where(eq(books.id, book.id));
  await storage.delete(book.coverKey);
  const p = await pick(source, await source.find(book), rejected);
  if (p && (await keep(db, storage, { ...book, coverRejected: rejected }, p, now()))) return "replaced";
  return "cleared";
}

/** A search result as the Covers page shows it: the preview as a data: address (the site shows no other site's pictures). */
export type ShownChoice = Omit<CoverChoice, "preview"> & { preview: string };

/**
 * "Choose a cover" (C3a): the catalogues' records with a picture for the words the reader typed, each with a
 * preview, and what a catalogue that could not be asked said. A result whose preview is not a cover's size and
 * shape is left out (it could not be chosen either).
 */
export async function searchCovers(source: CoverSource, words: string): Promise<{ choices: ShownChoice[]; unreachable: string[] }> {
  let found: { choices: CoverChoice[]; unreachable: string[] };
  if (source instanceof CoverSources) found = await source.searchEach(words);
  else {
    try {
      found = { choices: await source.search(words), unreachable: [] };
    } catch (e) {
      if (!(e instanceof CoverSourceError)) throw e;
      found = { choices: [], unreachable: [e.message] };
    }
  }
  const choices: ShownChoice[] = [];
  for (const c of found.choices) {
    const image = c.preview ? checkCover(c.preview) : null;
    if (!image || "refused" in image) continue;
    choices.push({ ...c, preview: `data:${image.contentType};base64,${Buffer.from(image.data).toString("base64")}` });
  }
  return { choices, unreachable: found.unreachable };
}

/**
 * The cover the reader chose from their own search (C3a): stored like a found cover, in place of the found one
 * (whose picture is then never offered again, as with "Not this cover") or as a title's first. Never in place of
 * the cover inside the book's file. The browser sends only the result's code; the addresses are rebuilt from it.
 */
export async function chooseCover(
  db: Db,
  storage: Storage,
  source: CoverSource,
  ownerId: string,
  bookId: string,
  choice: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  const [book] = /^[0-9a-f-]{36}$/i.test(bookId)
    ? await db
        .select()
        .from(books)
        .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId), isNull(books.deletedAt)))
    : [];
  if (!book) throw new CoverError("Book not found.");
  if (book.coverSource === "file") throw new CoverError("This title has the cover inside its book file.");
  const candidate = candidateOfChoice(choice);
  if (!candidate || !source.name.split("+").includes(candidate.source)) throw new CoverError("That is not a cover from the catalogues.");
  if (candidate.imageUrl === book.coverRef) return;
  const data = await source.download(candidate);
  if (!data) throw new CoverError("The catalogue has no picture there after all.");
  const image = checkCover(data);
  if ("refused" in image) throw new CoverError(`That picture cannot be a cover: ${image.refused}.`);
  // The ISBN is a bonus: the cover stands without it.
  const isbn = await source.isbnOf(candidate).catch(() => null);
  const key = foundCoverKey(book.ownerId, book.id, candidate.imageUrl, image.ext);
  await storage.put(key, image.data, image.contentType);
  const rejected = [...book.coverRejected.filter((r) => r !== candidate.imageUrl), ...(book.coverRef ? [book.coverRef] : [])];
  const done = await db
    .update(books)
    .set({
      coverKey: key,
      coverSource: candidate.source,
      coverRef: candidate.imageUrl,
      coverPage: candidate.pageUrl,
      coverRejected: rejected,
      coverCheckedAt: now(),
      ...(isbn ? { isbn } : {}),
    })
    // Not if the book file's own cover arrived meanwhile.
    .where(and(eq(books.id, book.id), or(isNull(books.coverSource), inArray(books.coverSource, [...REPLACEABLE]))))
    .returning({ id: books.id });
  if (!done.length) {
    await storage.delete(key);
    throw new CoverError("This title has the cover inside its book file.");
  }
  if (book.coverKey && book.coverKey !== key) await storage.delete(book.coverKey);
}

/** The reader's own picture's name: never a book file's cover (covers/<owner>/<book>.<ext>) or a found one's. */
export const uploadCoverKey = (ownerId: string, bookId: string, data: Uint8Array, ext: string) =>
  `covers/${ownerId}/${bookId}-upload-${createHash("sha256").update(data).digest("hex").slice(0, 10)}.${ext}`;

/**
 * The reader's own picture as a title's cover (C3b): a JPEG, PNG or WebP of a cover's size and shape (checked
 * here from its bytes, whatever the browser said it was), in place of a found one (never offered again) or as a
 * title's first. Never in place of the cover inside the book's file.
 */
export async function uploadCover(
  db: Db,
  storage: Storage,
  ownerId: string,
  bookId: string,
  data: Uint8Array,
  now: () => Date = () => new Date(),
): Promise<void> {
  const [book] = /^[0-9a-f-]{36}$/i.test(bookId)
    ? await db
        .select()
        .from(books)
        .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId), isNull(books.deletedAt)))
    : [];
  if (!book) throw new CoverError("Book not found.");
  if (book.coverSource === "file") throw new CoverError("This title has the cover inside its book file.");
  const image = checkCover(data);
  if ("refused" in image) throw new CoverError(`That picture cannot be a cover: ${image.refused}.`);
  const key = uploadCoverKey(book.ownerId, book.id, image.data, image.ext);
  if (key === book.coverKey) return;
  await storage.put(key, image.data, image.contentType);
  const done = await db
    .update(books)
    .set({
      coverKey: key,
      coverSource: "upload",
      coverRef: null,
      coverPage: null,
      coverRejected: book.coverRef ? [...book.coverRejected, book.coverRef] : book.coverRejected,
      coverCheckedAt: now(),
    })
    // Not if the book file's own cover arrived meanwhile.
    .where(and(eq(books.id, book.id), or(isNull(books.coverSource), inArray(books.coverSource, [...REPLACEABLE]))))
    .returning({ id: books.id });
  if (!done.length) {
    await storage.delete(key);
    throw new CoverError("This title has the cover inside its book file.");
  }
  if (book.coverKey && book.coverKey !== key) await storage.delete(book.coverKey);
}

/** How many of a reader's titles have a found cover, and how many still have none (for the page that lists them). */
export async function coverCounts(db: Db, ownerId: string) {
  const [row] = await db
    .select({
      found: sql<number>`count(*) filter (where ${books.coverSource} in ('openlibrary', 'googlebooks', 'fake', 'upload'))`.mapWith(Number),
      none: sql<number>`count(*) filter (where ${books.coverKey} is null)`.mapWith(Number),
    })
    .from(books)
    .where(and(eq(books.ownerId, ownerId), isNull(books.deletedAt), isNull(books.editionOf)));
  return row ?? { found: 0, none: 0 };
}
