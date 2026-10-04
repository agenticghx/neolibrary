import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, readingSessions } from "@/lib/db/schema";

/**
 * Reading statistics (M10). The reader measures a sitting and reports it in
 * small batches; each report carries the sitting's running totals, so a
 * repeated or late report never counts anything twice (the larger total wins).
 */
export class StatsError extends Error {}

/** Longest believable sitting, so a broken clock cannot inflate the numbers. */
const MAX_SECONDS = 12 * 60 * 60;
const MAX_WORDS = 500_000;

export async function recordReading(
  db: Db,
  ownerId: string,
  input: { sessionId: unknown; bookId: string; startedAt: unknown; activeSeconds: unknown; words: unknown; pages: unknown },
  now = new Date(),
) {
  if (typeof input.sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.sessionId)) throw new StatsError("Bad session.");
  const [book] = /^[0-9a-f-]{36}$/i.test(input.bookId)
    ? await db.select({ id: books.id }).from(books).where(and(eq(books.id, input.bookId), eq(books.ownerId, ownerId)))
    : [];
  if (!book) throw new StatsError("Book not found");
  const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const activeSeconds = int(input.activeSeconds, MAX_SECONDS);
  const words = int(input.words, MAX_WORDS);
  const pages = int(input.pages, 100_000);
  const started = new Date(String(input.startedAt));
  const startedAt = Number.isNaN(started.getTime()) || started > now ? now : started;
  // Upsert: the sitting's totals only grow; a session belongs to its first owner and book.
  await db
    .insert(readingSessions)
    .values({ id: input.sessionId, ownerId, bookId: input.bookId, startedAt, endedAt: now, activeSeconds, words, pages })
    .onConflictDoUpdate({
      target: readingSessions.id,
      set: {
        endedAt: now,
        activeSeconds: sql`greatest(${readingSessions.activeSeconds}, ${activeSeconds})`,
        words: sql`greatest(${readingSessions.words}, ${words})`,
        pages: sql`greatest(${readingSessions.pages}, ${pages})`,
      },
      setWhere: and(eq(readingSessions.ownerId, ownerId), eq(readingSessions.bookId, input.bookId)),
    });
}

/** Words per minute, rounded, or null when there is too little reading to say (under a minute). */
export function wordsPerMinute(words: number, activeSeconds: number) {
  if (activeSeconds < 60) return null;
  return Math.round(words / (activeSeconds / 60));
}

export type BookStats = { bookId: string; title: string; author: string; activeSeconds: number; words: number; pages: number; sessions: number; wpm: number | null };

/** Totals per book for one reader, most read first. */
export async function statsByBook(db: Db, ownerId: string): Promise<BookStats[]> {
  const rows = await db
    .select({
      bookId: readingSessions.bookId,
      title: books.title,
      author: books.author,
      activeSeconds: sql<number>`sum(${readingSessions.activeSeconds})::int`,
      words: sql<number>`sum(${readingSessions.words})::int`,
      pages: sql<number>`sum(${readingSessions.pages})::int`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(readingSessions)
    .innerJoin(books, eq(books.id, readingSessions.bookId))
    .where(eq(readingSessions.ownerId, ownerId))
    .groupBy(readingSessions.bookId, books.title, books.author)
    .orderBy(sql`sum(${readingSessions.activeSeconds}) desc`, asc(books.title));
  return rows.map((r) => ({ ...r, wpm: wordsPerMinute(r.words, r.activeSeconds) }));
}
