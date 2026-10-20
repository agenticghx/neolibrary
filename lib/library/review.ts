import { and, count, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { reviewCards } from "@/lib/db/schema";
import { checkItems, partPassages } from "./explain-back";
import { parseQuestions } from "./questions";
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
 *
 * M28 S1: every question of a chapter's newest Test yourself bank is a card
 * too (a newer bank, made fresh or in another style, replaces the older one's
 * cards). A question card is new from the day after its bank was made, never
 * the same day: recalling it minutes after answering it in Study is rereading.
 *
 * M28 S2: what a chapter's newest Explain it back attempt found missing is a card too ("gap"): Claude's question
 * on the front, the book's own line behind it, on the same day-after rule. An attempt made before Claude was asked
 * for questions gives no cards.
 */
export const NEW_PER_DAY = 20;

/**
 * Whole days (UTC) a new question card waits after its bank was made: 1, or REVIEW_QUESTION_DELAY_DAYS (the browser
 * tests set 0, as the server's clock cannot be moved from a test; the unit tests check the wait with their own clock).
 */
export function questionDelayDays(env: Record<string, string | undefined> = process.env) {
  const v = env.REVIEW_QUESTION_DELAY_DAYS ?? "";
  return /^\d{1,2}$/.test(v) && Number(v) <= 30 ? Number(v) : 1;
}

export class ReviewError extends Error {}

export type ReviewCard = {
  /**
   * The card's name: a highlight's or note's stable id, "q:<bank id>:<question number>" for a question, or
   * "g:<attempt id>:<item number>" for a gap Explain it back found.
   */
  id: string;
  kind: "highlight" | "note" | "question" | "gap";
  /** A passage (with a quote and a place in the book; a gap's passage), a note on the whole book, or a question on a chapter. */
  on: "passage" | "book" | "chapter";
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  /** The chapter the passage or question is in, when the book's contents say. */
  chapter: string;
  /** The passage's place; for a question, the chapter's first paragraph. */
  cfi: string | null;
  /** The passage's words; for a gap, the book's line only when Claude quoted it word for word, else "". */
  quote: string;
  /** The reader's own note ("" for a highlight without one, and for a question). */
  note: string;
  /**
   * A question card's question and its bank's answer; a gap card's question and the start of its passage (shown
   * when `quote` is ""). "" for other cards.
   */
  question: string;
  answer: string;
  isNew: boolean;
  createdAt: string;
  dueAt: string | null;
  /** Days until it comes back for each rating (0: later today). */
  next: Record<Rating, number>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QUESTION_CARD = /^q:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{1,3})$/i;
const GAP_CARD = /^g:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{1,3})$/i;

/** A question card's name: "q:<bank id>:<question number>". */
export const questionCardId = (bankId: string, index: number) => `q:${bankId.toLowerCase()}:${index}`;

/** A gap card's name: "g:<Explain it back attempt id>:<item number in Claude's answer>". */
export const gapCardId = (attemptId: string, index: number) => `g:${attemptId.toLowerCase()}:${index}`;

type Row = {
  id: string;
  kind: ReviewCard["kind"];
  targetType: ReviewCard["on"];
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  chapter: string;
  cfi: string | null;
  quote: string;
  note: string;
  question: string;
  answer: string;
  createdAt: Date;
  /** Orders the questions of one bank, which share a createdAt. */
  order: number;
  /** When a new card may first be shown. */
  availableFrom: Date;
  schedule: Schedule | null;
};

// postgres.js (through Drizzle) hands timestamps back as text, PGlite as Dates: read both.
const asDate = (v: unknown) => (v == null ? null : new Date(v as string));

const listOf = (rows: unknown) => (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as Record<string, unknown>[];

/** A review_cards row's schedule (null: the card has not been rated). */
const scheduleOf = (r: Record<string, unknown>): Schedule | null =>
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
      };

/** Every highlight and note card of a reader (or the one with `annotationId`), with its schedule if it has been rated. */
async function annotationRows(db: Db, ownerId: string, annotationId?: string): Promise<Row[]> {
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
    LEFT JOIN review_cards r ON r.owner_id = ${ownerId} AND r.card_id = a.annotation_id::text
    WHERE NOT a.deleted AND (
      (a.target_type = 'passage' AND a.kind IN ('highlight', 'note') AND a.cfi IS NOT NULL AND btrim(a.quote_exact) <> '')
      OR (a.target_type = 'book' AND a.kind = 'note' AND btrim(a.body) <> '')
    )
  `);
  return listOf(rows).map((r) => {
    const createdAt = asDate(r.createdAt)!;
    return {
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
      question: "",
      answer: "",
      createdAt,
      order: 0,
      availableFrom: createdAt,
      schedule: scheduleOf(r),
    };
  });
}

/**
 * Every question card of a reader: each question of the newest Test yourself bank of each chapter, in a book still
 * in the library, with its schedule if it has been rated.
 */
async function questionRows(db: Db, ownerId: string, delayDays: number): Promise<Row[]> {
  const banks = listOf(
    await db.execute(sql`
      WITH banks AS (
        SELECT DISTINCT ON (book_id, section_id) id, book_id, section_id, output, created_at FROM generations
        WHERE owner_id = ${ownerId} AND kind = 'questions' AND book_id IS NOT NULL AND section_id IS NOT NULL
        ORDER BY book_id, section_id, created_at DESC, id DESC
      )
      SELECT g.id, g.book_id AS "bookId", g.output, g.created_at AS "createdAt",
             b.title AS "bookTitle", b.author AS "bookAuthor", c.label AS chapter, p.cfi
      FROM banks g
      JOIN books b ON b.id = g.book_id AND b.owner_id = ${ownerId} AND b.deleted_at IS NULL
      -- A book's sections are rebuilt from its file after a library import: until then the card has no chapter name.
      LEFT JOIN sections c ON c.book_id = g.book_id AND c.id = g.section_id AND c.kind = 'chapter'
      LEFT JOIN LATERAL (
        SELECT cfi FROM sections s
        WHERE s.book_id = g.book_id AND s.kind = 'paragraph' AND s.chapter_index = c.chapter_index
        ORDER BY s.position LIMIT 1
      ) p ON true
    `),
  );
  if (!banks.length) return [];
  const schedules = await cardSchedules(db, ownerId, "q");
  return banks.flatMap((b) => {
    const createdAt = asDate(b.createdAt)!;
    return parseQuestions(b.output as string).map((q) => {
      const id = questionCardId(b.id as string, q.index);
      return {
        id,
        kind: "question" as const,
        targetType: "chapter" as const,
        bookId: b.bookId as string,
        bookTitle: b.bookTitle as string,
        bookAuthor: (b.bookAuthor as string) ?? "",
        chapter: (b.chapter as string) ?? "",
        cfi: (b.cfi as string | null) ?? null,
        quote: "",
        note: "",
        question: q.question,
        answer: q.answer,
        createdAt,
        order: q.index,
        availableFrom: dayAfter(createdAt, delayDays),
        schedule: schedules.get(id) ?? null,
      };
    });
  });
}

/** The schedules of a reader's cards whose names start with `letter` and a colon ("q", "g"). */
async function cardSchedules(db: Db, ownerId: string, letter: "q" | "g") {
  return new Map(
    listOf(
      await db.execute(sql`
        SELECT card_id AS "cardId", ease, interval_days AS "intervalDays", reps, lapses, due_at AS "dueAt",
               first_reviewed_at AS "firstReviewedAt", last_reviewed_at AS "lastReviewedAt", last_rating AS "lastRating"
        FROM review_cards WHERE owner_id = ${ownerId} AND annotation_id IS NULL AND card_id LIKE ${`${letter}:%`}
      `),
    ).map((r) => [r.cardId as string, scheduleOf(r)]),
  );
}

/**
 * Every gap card of a reader: each item with a question in the newest Explain it back attempt of each part of a
 * book still in the library, with its schedule if it has been rated. Items are checked against the part's
 * paragraphs as Study shows them (checkItems): a quote not found word for word is not given as the book's line.
 * A part whose paragraphs are not there (a book's sections are rebuilt from its file after a library import) gives
 * no cards until they are, as Study then shows no items either.
 */
async function gapRows(db: Db, ownerId: string, delayDays: number): Promise<Row[]> {
  const attempts = listOf(
    await db.execute(sql`
      WITH attempts AS (
        SELECT DISTINCT ON (book_id, section_id) id, book_id, section_id, output, created_at FROM generations
        WHERE owner_id = ${ownerId} AND kind = 'explain-back' AND book_id IS NOT NULL AND section_id IS NOT NULL
        ORDER BY book_id, section_id, created_at DESC, id DESC
      )
      SELECT g.id, g.book_id AS "bookId", g.output, g.created_at AS "createdAt",
             b.title AS "bookTitle", b.author AS "bookAuthor", c.id AS "chapterId", c.label AS chapter, c.chapter_index AS "chapterIndex"
      FROM attempts g
      JOIN books b ON b.id = g.book_id AND b.owner_id = ${ownerId} AND b.deleted_at IS NULL
      JOIN sections c ON c.book_id = g.book_id AND c.id = g.section_id AND c.kind = 'chapter'
    `),
  );
  if (!attempts.length) return [];
  const schedules = await cardSchedules(db, ownerId, "g");
  const rows: Row[] = [];
  for (const a of attempts) {
    const chapter = { id: a.chapterId as string, label: (a.chapter as string) ?? "", chapterIndex: Number(a.chapterIndex) };
    const passages = await partPassages(db, a.bookId as string, chapter).catch(() => []);
    const createdAt = asDate(a.createdAt)!;
    for (const item of checkItems(a.output as string, passages)) {
      if (!item.question) continue;
      const id = gapCardId(a.id as string, item.index);
      rows.push({
        id,
        kind: "gap",
        targetType: "passage",
        bookId: a.bookId as string,
        bookTitle: a.bookTitle as string,
        bookAuthor: (a.bookAuthor as string) ?? "",
        chapter: chapter.label,
        cfi: item.cfi,
        quote: item.quote ?? "",
        note: "",
        question: item.question,
        answer: item.excerpt,
        createdAt,
        order: item.index,
        availableFrom: dayAfter(createdAt, delayDays),
        schedule: schedules.get(id) ?? null,
      });
    }
  }
  return rows;
}

const toCard = (r: Row): ReviewCard => ({
  id: r.id,
  kind: r.kind,
  on: r.targetType,
  bookId: r.bookId,
  bookTitle: r.bookTitle,
  bookAuthor: r.bookAuthor,
  chapter: r.chapter,
  cfi: r.targetType === "book" ? null : r.cfi,
  quote: r.targetType === "passage" ? r.quote : "",
  note: r.note,
  question: r.question,
  answer: r.answer,
  isNew: !r.schedule,
  createdAt: r.createdAt.toISOString(),
  dueAt: r.schedule?.dueAt.toISOString() ?? null,
  next: intervals(r.schedule),
});

const byTime = (a: Date, b: Date) => a.getTime() - b.getTime();
const inOrder = (a: Row, b: Row) => byTime(a.createdAt, b.createdAt) || a.order - b.order || a.id.localeCompare(b.id);

export type ReviewQueue = {
  /** Today's cards, in order: those due (earliest first), then new ones (oldest first, up to the day's allowance). */
  cards: ReviewCard[];
  /** When the next card comes due after today's are done (null: no cards at all). */
  nextDueAt: string | null;
  /** All the reader's cards, due or not. */
  total: number;
};

/** Every card of a reader: highlights and notes, then questions, then gaps. */
const allRows = async (db: Db, ownerId: string, delayDays: number) => [
  ...(await annotationRows(db, ownerId)),
  ...(await questionRows(db, ownerId, delayDays)),
  ...(await gapRows(db, ownerId, delayDays)),
];

/** Today's review for a reader at `now`. */
export async function reviewQueue(db: Db, ownerId: string, now = new Date(), newPerDay = NEW_PER_DAY, delayDays = questionDelayDays()): Promise<ReviewQueue> {
  const rows = await allRows(db, ownerId, delayDays);
  const [{ n: introduced }] = await db
    .select({ n: count() })
    .from(reviewCards)
    .where(and(eq(reviewCards.ownerId, ownerId), gte(reviewCards.firstReviewedAt, startOfDay(now))));
  const due = rows
    .filter((r) => r.schedule && r.schedule.dueAt.getTime() <= now.getTime())
    .sort((a, b) => byTime(a.schedule!.dueAt, b.schedule!.dueAt) || inOrder(a, b));
  const unrated = rows.filter((r) => !r.schedule);
  const fresh = unrated.filter((r) => r.availableFrom.getTime() <= now.getTime()).sort(inOrder);
  const allowance = Math.max(0, newPerDay - Number(introduced));
  const later = rows.filter((r) => r.schedule && r.schedule.dueAt.getTime() > now.getTime()).map((r) => r.schedule!.dueAt);
  // New cards held back by today's allowance come tomorrow; questions not yet a day old, from their day.
  if (fresh.length > allowance) later.push(dayAfter(now, 1));
  for (const r of unrated) if (r.availableFrom.getTime() > now.getTime()) later.push(r.availableFrom);
  later.sort(byTime);
  return { cards: [...due, ...fresh.slice(0, allowance)].map(toCard), nextDueAt: later[0]?.toISOString() ?? null, total: rows.length };
}

/** How many cards are waiting today (the sidebar's count). */
export async function dueCount(db: Db, ownerId: string, now = new Date()) {
  return (await reviewQueue(db, ownerId, now)).cards.length;
}

/** The card named `cardId`, if it is one of this reader's current cards. */
async function findCard(db: Db, ownerId: string, cardId: unknown): Promise<Row | undefined> {
  if (typeof cardId !== "string") return undefined;
  if (UUID.test(cardId)) return (await annotationRows(db, ownerId, cardId.toLowerCase()))[0];
  if (QUESTION_CARD.test(cardId)) {
    const id = cardId.toLowerCase();
    return (await questionRows(db, ownerId, 0)).find((r) => r.id === id);
  }
  if (GAP_CARD.test(cardId)) {
    const id = cardId.toLowerCase();
    return (await gapRows(db, ownerId, 0)).find((r) => r.id === id);
  }
  return undefined;
}

/** Rates a card at `now` and stores its next date. Refuses anything that is not one of this reader's current cards. */
export async function rateCard(db: Db, ownerId: string, cardId: unknown, rating: unknown, now = new Date()) {
  if (typeof cardId !== "string" || !(UUID.test(cardId) || QUESTION_CARD.test(cardId) || GAP_CARD.test(cardId))) throw new ReviewError("Card not found.");
  if (!isRating(rating)) throw new ReviewError("Rate it Again, Hard, Good or Easy.");
  const row = await findCard(db, ownerId, cardId);
  if (!row) throw new ReviewError("Card not found.");
  const next = schedule(row.schedule, rating, now);
  await db
    .insert(reviewCards)
    .values({ ownerId, cardId: row.id, annotationId: row.kind === "highlight" || row.kind === "note" ? row.id : null, ...next })
    .onConflictDoUpdate({ target: [reviewCards.ownerId, reviewCards.cardId], set: { ...next } });
  return next;
}
