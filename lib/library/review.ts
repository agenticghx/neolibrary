import { and, count, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { reviewCards } from "@/lib/db/schema";
import { dayAfter, intervals, isRating, schedule, startOfDay, type Rating, type Schedule } from "./review-schedule";

/**
 * Daily review (M21): the reader's own highlights and notes come back, one at
 * a time, on a spaced-repetition schedule (./review-schedule.ts).
 *
 * A card is a current (latest version, not removed) highlight or note that
 * quotes a passage (it has a CFI and quoted text), or a note on a whole book,
 * on a book still in the library. Bookmarks, voice notes, stickers, drawings,
 * pictures and notes on a Path are not cards. A card with no row in
 * review_cards is new: at most NEW_PER_DAY new cards are introduced a day,
 * oldest first, after the cards already due.
 */
export const NEW_PER_DAY = 20;

export class ReviewError extends Error {}

export type ReviewCard = {
  /** The annotation's stable id. */
  id: string;
  kind: "highlight" | "note";
  /** A passage (with a quote and a place in the book), or a note on the whole book. */
  on: "passage" | "book";
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  /** The chapter the passage is in, when the book's contents say. */
  chapter: string;
  cfi: string | null;
  quote: string;
  /** The reader's own note ("" for a highlight without one). */
  note: string;
  isNew: boolean;
  createdAt: string;
  dueAt: string | null;
  /** Days until it comes back for each rating (0: later today). */
  next: Record<Rating, number>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  id: string;
  kind: "highlight" | "note";
  targetType: "passage" | "book";
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  chapter: string;
  cfi: string | null;
  quote: string;
  note: string;
  createdAt: Date;
  schedule: Schedule | null;
};

// postgres.js (through Drizzle) hands timestamps back as text, PGlite as Dates: read both.
const asDate = (v: unknown) => (v == null ? null : new Date(v as string));

/** Every card of a reader (or the one with `annotationId`), with its schedule if it has been rated. */
async function cardRows(db: Db, ownerId: string, annotationId?: string): Promise<Row[]> {
  const rows = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (annotation_id) * FROM annotations
      WHERE owner_id = ${ownerId} ${annotationId ? sql`AND annotation_id = ${annotationId}` : sql``}
      ORDER BY annotation_id, version DESC
    ),
    first AS (
      SELECT annotation_id, min(created_at) AS created_at FROM annotations
      WHERE owner_id = ${ownerId} ${annotationId ? sql`AND annotation_id = ${annotationId}` : sql``}
      GROUP BY annotation_id
    )
    SELECT a.annotation_id AS id, a.kind, a.target_type AS "targetType", a.book_id AS "bookId",
           b.title AS "bookTitle", b.author AS "bookAuthor", coalesce(ch.label, '') AS chapter,
           a.cfi, a.quote_exact AS quote, a.body AS note, f.created_at AS "createdAt",
           r.ease, r.interval_days AS "intervalDays", r.reps, r.lapses, r.due_at AS "dueAt",
           r.first_reviewed_at AS "firstReviewedAt", r.last_reviewed_at AS "lastReviewedAt", r.last_rating AS "lastRating"
    FROM latest a
    JOIN first f ON f.annotation_id = a.annotation_id
    JOIN books b ON b.id = a.book_id AND b.owner_id = ${ownerId} AND b.deleted_at IS NULL
    LEFT JOIN sections s ON s.book_id = a.book_id AND s.id = a.section_id
    LEFT JOIN LATERAL (
      SELECT label FROM sections c
      WHERE c.book_id = a.book_id AND c.kind = 'chapter' AND c.chapter_index = s.chapter_index
      ORDER BY c.position LIMIT 1
    ) ch ON true
    LEFT JOIN review_cards r ON r.owner_id = ${ownerId} AND r.annotation_id = a.annotation_id
    WHERE NOT a.deleted AND (
      (a.target_type = 'passage' AND a.kind IN ('highlight', 'note') AND a.cfi IS NOT NULL AND btrim(a.quote_exact) <> '')
      OR (a.target_type = 'book' AND a.kind = 'note' AND btrim(a.body) <> '')
    )
  `);
  const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as Record<string, unknown>[];
  return list.map((r) => ({
    id: r.id as string,
    kind: r.kind as Row["kind"],
    targetType: r.targetType as Row["targetType"],
    bookId: r.bookId as string,
    bookTitle: r.bookTitle as string,
    bookAuthor: (r.bookAuthor as string) ?? "",
    chapter: (r.chapter as string) ?? "",
    cfi: (r.cfi as string | null) ?? null,
    quote: r.quote as string,
    note: r.note as string,
    createdAt: asDate(r.createdAt)!,
    schedule:
      r.dueAt == null
        ? null
        : {
            ease: Number(r.ease),
            intervalDays: Number(r.intervalDays),
            reps: Number(r.reps),
            lapses: Number(r.lapses),
            dueAt: asDate(r.dueAt)!,
            firstReviewedAt: asDate(r.firstReviewedAt)!,
            lastReviewedAt: asDate(r.lastReviewedAt)!,
            lastRating: r.lastRating as Rating,
          },
  }));
}

const toCard = (r: Row): ReviewCard => ({
  id: r.id,
  kind: r.kind,
  on: r.targetType === "book" ? "book" : "passage",
  bookId: r.bookId,
  bookTitle: r.bookTitle,
  bookAuthor: r.bookAuthor,
  chapter: r.chapter,
  cfi: r.targetType === "book" ? null : r.cfi,
  quote: r.targetType === "book" ? "" : r.quote,
  note: r.note,
  isNew: !r.schedule,
  createdAt: r.createdAt.toISOString(),
  dueAt: r.schedule?.dueAt.toISOString() ?? null,
  next: intervals(r.schedule),
});

const byTime = (a: Date, b: Date) => a.getTime() - b.getTime();

export type ReviewQueue = {
  /** Today's cards, in order: those due (earliest first), then new ones (oldest first, up to the day's allowance). */
  cards: ReviewCard[];
  /** When the next card comes due after today's are done (null: no cards at all). */
  nextDueAt: string | null;
  /** All the reader's cards, due or not. */
  total: number;
};

/** Today's review for a reader at `now`. */
export async function reviewQueue(db: Db, ownerId: string, now = new Date(), newPerDay = NEW_PER_DAY): Promise<ReviewQueue> {
  const rows = await cardRows(db, ownerId);
  const [{ n: introduced }] = await db
    .select({ n: count() })
    .from(reviewCards)
    .where(and(eq(reviewCards.ownerId, ownerId), gte(reviewCards.firstReviewedAt, startOfDay(now))));
  const due = rows
    .filter((r) => r.schedule && r.schedule.dueAt.getTime() <= now.getTime())
    .sort((a, b) => byTime(a.schedule!.dueAt, b.schedule!.dueAt) || byTime(a.createdAt, b.createdAt) || a.id.localeCompare(b.id));
  const fresh = rows.filter((r) => !r.schedule).sort((a, b) => byTime(a.createdAt, b.createdAt) || a.id.localeCompare(b.id));
  const allowance = Math.max(0, newPerDay - Number(introduced));
  const later = rows.filter((r) => r.schedule && r.schedule.dueAt.getTime() > now.getTime()).map((r) => r.schedule!.dueAt);
  // New cards held back by today's allowance come tomorrow.
  if (fresh.length > allowance) later.push(dayAfter(now, 1));
  later.sort(byTime);
  return { cards: [...due, ...fresh.slice(0, allowance)].map(toCard), nextDueAt: later[0]?.toISOString() ?? null, total: rows.length };
}

/** How many cards are waiting today (the sidebar's count). */
export async function dueCount(db: Db, ownerId: string, now = new Date()) {
  return (await reviewQueue(db, ownerId, now)).cards.length;
}

/** Rates a card at `now` and stores its next date. Refuses anything that is not one of this reader's current cards. */
export async function rateCard(db: Db, ownerId: string, annotationId: unknown, rating: unknown, now = new Date()) {
  if (typeof annotationId !== "string" || !UUID.test(annotationId)) throw new ReviewError("Card not found.");
  if (!isRating(rating)) throw new ReviewError("Rate it Again, Hard, Good or Easy.");
  const [row] = await cardRows(db, ownerId, annotationId.toLowerCase());
  if (!row) throw new ReviewError("Card not found.");
  const next = schedule(row.schedule, rating, now);
  await db
    .insert(reviewCards)
    .values({ ownerId, annotationId: row.id, ...next })
    .onConflictDoUpdate({ target: [reviewCards.ownerId, reviewCards.annotationId], set: { ...next } });
  return next;
}
