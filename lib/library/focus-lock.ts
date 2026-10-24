import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, focusSessions } from "@/lib/db/schema";
import { getBook } from "@/lib/library/paths";
import {
  answerWordsFor,
  cleanDays,
  cleanMinutes,
  cleanQuestion,
  DEFAULT_BOOK_WAIT_HOURS,
  DEFAULT_WAIT_MINUTES,
  earlyAnswerProblem,
  FINISHED_AT,
  MAX_BOOK_DAYS,
  MAX_MINUTES,
  MIN_MINUTES,
} from "@/lib/reader/focus-session";

import type { RunningFocus } from "./focus-redirect";

export { focusRedirect } from "./focus-redirect";

/**
 * A focus session you cannot walk away from (M26 R4a). The running session is a row in focus_sessions, so every
 * page on every device can ask "is one running?" and send the reader back to the focused book, and the routes that
 * serve a book's file can refuse another book's (423 Locked). The database keeps one open session per reader.
 *
 * Words used here: a session is *open* until it is ended (ended_at is set); it is *running* while it is open and
 * its time is not up. Only a running session locks anything: once the time is up every page opens again, even if
 * the reader has not yet answered "Did you answer it?" (that waits in the reader, on the focused book).
 *
 * The ways out before the time is up (M26 R4b), judged here and not by the page, so no request can skip them: an
 * answer of at least 40 words (it ends the session at once, as "answered"), or a wait (10 minutes; Leave early
 * starts it, Keep reading cancels it). Once the wait runs out the session stops locking, as when the time is up,
 * and ends as "waited". Nothing else ends a session early.
 *
 * Whole-book focus (M26 R5) is a row of kind "book": one book only, for days (kept as minutes, days x 1440). It
 * locks less (the pages that list other books, and other books, not every page: lib/library/focus-redirect.ts),
 * its ways out are longer (150 words, or a 24-hour wait), and reaching the last page ends it as "finished". The
 * server judges the last page from the book's saved place, as it judges every other ending.
 */
export class FocusError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type FocusRow = typeof focusSessions.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A device whose clock runs a little ahead says "time's up" a few seconds early: still counted as on time. */
const ON_TIME_MS = 5_000;

/**
 * How long the wait to leave early lasts: 10 minutes for a sitting, 24 hours for a whole book. FOCUS_WAIT_MS and
 * FOCUS_BOOK_WAIT_MS shorten them for the browser tests.
 */
export function waitMs(kind: string = "sitting", env: Record<string, string | undefined> = process.env) {
  const ms = Number(kind === "book" ? env.FOCUS_BOOK_WAIT_MS : env.FOCUS_WAIT_MS);
  if (Number.isFinite(ms) && ms > 0) return ms;
  return kind === "book" ? DEFAULT_BOOK_WAIT_HOURS * 3_600_000 : DEFAULT_WAIT_MINUTES * 60_000;
}

/** When the session stops locking: when its time is up, or sooner when a wait to leave early runs out. */
export const freeAt = (s: Pick<FocusRow, "endsAt" | "waitEndsAt">) =>
  s.waitEndsAt && s.waitEndsAt.getTime() < s.endsAt.getTime() ? s.waitEndsAt : s.endsAt;

export const isRunning = (s: Pick<FocusRow, "endedAt" | "endsAt" | "waitEndsAt">, now = new Date()) =>
  !s.endedAt && freeAt(s).getTime() > now.getTime();

/**
 * The reader may go: the time is up, or the wait has run out (a device clock a few seconds ahead counts as on time),
 * or, for a whole book, the reader has reached its last page (`finished`, judged by bookFinished).
 */
export const mayLeave = (s: Pick<FocusRow, "endsAt" | "waitEndsAt">, now = new Date(), finished = false) =>
  finished || freeAt(s).getTime() - now.getTime() <= ON_TIME_MS;

/** How an open session ends now: "time", "waited", "finished", "answered", or null when it may not end yet. */
function howItEnds(s: FocusRow, answered: boolean, now: Date, finished: boolean): FocusRow["endedHow"] {
  if (s.endsAt.getTime() - now.getTime() <= ON_TIME_MS) return "time";
  if (s.waitEndsAt && s.waitEndsAt.getTime() - now.getTime() <= ON_TIME_MS) return "waited";
  if (finished && s.kind === "book") return "finished";
  return answered ? "answered" : null;
}

/** The reader's open session, running or with its time up but not yet ended; null when there is none. */
export async function openFocus(db: Db, ownerId: string): Promise<FocusRow | null> {
  const [row] = await db
    .select()
    .from(focusSessions)
    .where(and(eq(focusSessions.ownerId, ownerId), isNull(focusSessions.endedAt)));
  return row ?? null;
}

/**
 * The reader's running session (open, time not up), or null: the one read every locked page makes. A whole book
 * whose last page has been reached (M26 R5) no longer runs, even before its question is answered: other books open
 * at once, and the question waits in the reader.
 */
export async function runningFocus(db: Db, ownerId: string, now = new Date()): Promise<FocusRow | null> {
  const row = await openFocus(db, ownerId);
  if (!row || !isRunning(row, now)) return null;
  return row.kind === "book" && (await bookFinished(db, ownerId, row)) ? null : row;
}

/** Sessions whose time (or wait) ran out while no device was open are closed, so they do not block the next one. */
async function closeTimedOut(db: Db, ownerId: string, now: Date) {
  const open = await db
    .select()
    .from(focusSessions)
    .where(and(eq(focusSessions.ownerId, ownerId), isNull(focusSessions.endedAt), or(lte(focusSessions.endsAt, now), lte(focusSessions.waitEndsAt, now))));
  for (const s of open) {
    const at = freeAt(s);
    const endedHow = at === s.endsAt ? "time" : "waited";
    await db.update(focusSessions).set({ endedAt: at, endedHow }).where(eq(focusSessions.id, s.id));
  }
}

/** Postgres's "unique_violation": the one-open-session index refused a second row (two starts at once). */
function isUniqueViolation(e: unknown): boolean {
  for (let x: unknown = e; x && typeof x === "object"; x = (x as { cause?: unknown }).cause) {
    if ((x as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/**
 * Starts a session on one of the reader's books: a sitting ({ minutes }), or a whole book ({ kind: "book", days }).
 * Refused (409) while another runs, of either kind (one open session per reader); a session whose time is up but
 * was never ended is closed first.
 */
export async function startFocus(
  db: Db,
  ownerId: string,
  input: { bookId: unknown; question: unknown; minutes?: unknown; kind?: unknown; days?: unknown },
  now = new Date(),
  ids: () => string = () => crypto.randomUUID(),
): Promise<FocusRow> {
  const kind = input.kind === "book" ? "book" : "sitting";
  const question = cleanQuestion(typeof input.question === "string" ? input.question : "");
  if (!question) throw new FocusError(kind === "book" ? "Write the question you are reading this book to answer." : "Write the question you are reading to answer.");
  let minutes: number | null;
  if (kind === "book") {
    const days = cleanDays(input.days);
    if (!days) throw new FocusError(`Set between 1 and ${MAX_BOOK_DAYS} days.`);
    minutes = days * 1440;
  } else {
    minutes = cleanMinutes(input.minutes);
    if (!minutes) throw new FocusError(`Set between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`);
  }
  const found = typeof input.bookId === "string" ? await getBook(db, ownerId, input.bookId) : null;
  if (!found || !found.available.read) throw new FocusError("Book not found.", 404);
  await closeTimedOut(db, ownerId, now);
  // A whole book read to its end but never answered: closed as finished, so it does not block the next session.
  const left = await openFocus(db, ownerId);
  if (left?.kind === "book" && (await bookFinished(db, ownerId, left))) {
    await db.update(focusSessions).set({ endedAt: now, endedHow: "finished" }).where(and(eq(focusSessions.id, left.id), isNull(focusSessions.endedAt)));
  }
  const open = await openFocus(db, ownerId);
  if (open) throw new FocusError("A focus session is already running. End it before starting another.", 409);
  try {
    const [row] = await db
      .insert(focusSessions)
      .values({
        id: ids(),
        ownerId,
        bookId: found.book.id,
        kind,
        question,
        minutes,
        noteId: ids(),
        startedAt: now,
        endsAt: new Date(now.getTime() + minutes * 60_000),
      })
      .returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new FocusError("A focus session is already running. End it before starting another.", 409);
    throw e;
  }
}

/** One of the reader's sessions by id, open or ended; null for anything else (someone else's, a bad id). */
export async function getFocus(db: Db, ownerId: string, id: unknown): Promise<FocusRow | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const [row] = await db
    .select()
    .from(focusSessions)
    .where(and(eq(focusSessions.id, id.toLowerCase()), eq(focusSessions.ownerId, ownerId)));
  return row ?? null;
}

/**
 * Ends a session: "time" when its time was up, "waited" when its wait had run out, "finished" when a whole book's
 * last page has been reached, otherwise "answered" (an answer long enough was saved: the route checks it with
 * `answerProblem` first). Without an answer, before any of these, it is refused (409): Leave early is a wait,
 * never one request. Ending one already ended changes nothing, so a retry or a second device is harmless. Null
 * when there is no such session.
 */
export async function endFocus(db: Db, ownerId: string, id: unknown, opts: { answered: boolean }, now = new Date()): Promise<FocusRow | null> {
  const row = await getFocus(db, ownerId, id);
  if (!row || row.endedAt) return row;
  const endedHow = howItEnds(row, opts.answered, now, await bookFinished(db, ownerId, row));
  if (!endedHow) throw new FocusError("The session is still running. To leave early, write your answer or start the wait.", 409);
  const [ended] = await db
    .update(focusSessions)
    .set({ endedAt: now, endedHow })
    .where(and(eq(focusSessions.id, row.id), isNull(focusSessions.endedAt)))
    .returning();
  // Another request ended it a moment before: read what that one wrote.
  return ended ?? (await getFocus(db, ownerId, row.id));
}

/**
 * Why this answer cannot end the session yet (too short, before the time is up, the wait has run out or, for a
 * whole book, the last page is reached), or null. `finished` comes from bookFinished.
 */
export function answerProblem(s: FocusRow | null, answer: string, now = new Date(), finished = false) {
  if (!s || s.endedAt) return null;
  return earlyAnswerProblem(answer, mayLeave(s, now, finished && s.kind === "book"), answerWordsFor(s.kind));
}

/**
 * Whole-book focus (M26 R5): has the reader reached the end of the focused book? Judged from the place the reader
 * saved (books.progress, 0 to 1), on either edition of a scanned book. Always false for a sitting.
 */
export async function bookFinished(db: Db, ownerId: string, s: Pick<FocusRow, "kind" | "bookId">): Promise<boolean> {
  if (s.kind !== "book") return false;
  const rows = await db
    .select({ progress: books.progress })
    .from(books)
    .where(and(eq(books.ownerId, ownerId), inArray(books.id, await bookIdsOf(db, ownerId, s.bookId))));
  return rows.some((r) => (r.progress ?? 0) >= FINISHED_AT);
}

/**
 * Every id a book goes by, the book first: a scanned book and its text edition are two books the reader moves
 * between (M25). Also the book's own page: the scan's, when there is one.
 */
export async function bookIdsOf(db: Db, ownerId: string, bookId: string): Promise<string[]> {
  return (await bookFamily(db, ownerId, bookId)).ids;
}

async function bookFamily(db: Db, ownerId: string, bookId: string): Promise<{ ids: string[]; homeId: string }> {
  const [book] = await db
    .select({ id: books.id, editionOf: books.editionOf })
    .from(books)
    .where(and(eq(books.ownerId, ownerId), eq(books.id, bookId)));
  if (!book) return { ids: [bookId], homeId: bookId };
  const scanId = book.editionOf ?? book.id;
  const editions = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.ownerId, ownerId), eq(books.editionOf, scanId)));
  const ids = [book.id, scanId, ...editions.map((e) => e.id)].filter((x, i, all) => all.indexOf(x) === i);
  return { ids, homeId: scanId };
}

/**
 * During a whole-book focus (M26 R5), every id the focused book goes by, so Daily review can keep to it; null
 * otherwise (no session, or a sitting).
 */
export async function focusedBookIds(db: Db, ownerId: string, now = new Date()): Promise<string[] | null> {
  const running = await runningFocus(db, ownerId, now);
  return running?.kind === "book" ? bookIdsOf(db, ownerId, running.bookId) : null;
}

/**
 * A running session as the redirect rule needs it (lib/library/focus-redirect.ts): for a whole book, with every id
 * the book goes by and its own page. Null for null.
 */
export async function redirectInfo(db: Db, ownerId: string, running: FocusRow | null): Promise<RunningFocus | null> {
  if (!running) return null;
  if (running.kind !== "book") return { bookId: running.bookId, kind: running.kind };
  const { ids, homeId } = await bookFamily(db, ownerId, running.bookId);
  return { bookId: running.bookId, kind: running.kind, bookIds: ids, homeId };
}

/**
 * Leave early (M26 R4b): starts the wait on the server, so a reload or another device does not skip it. Asking
 * again while a wait runs keeps the first one (it never moves later, or sooner). Null when there is no such session.
 */
export async function startWait(db: Db, ownerId: string, id: unknown, now = new Date(), wait?: number): Promise<FocusRow | null> {
  const row = await getFocus(db, ownerId, id);
  if (!row || row.endedAt || row.waitEndsAt || !isRunning(row, now)) return row;
  const [updated] = await db
    .update(focusSessions)
    .set({ waitEndsAt: new Date(now.getTime() + (wait ?? waitMs(row.kind))) })
    .where(and(eq(focusSessions.id, row.id), isNull(focusSessions.endedAt), isNull(focusSessions.waitEndsAt)))
    .returning();
  return updated ?? (await getFocus(db, ownerId, row.id));
}

/** Keep reading: cancels the wait, while it still runs (a wait that has run out has already let the reader go). */
export async function cancelWait(db: Db, ownerId: string, id: unknown, now = new Date()): Promise<FocusRow | null> {
  const row = await getFocus(db, ownerId, id);
  if (!row || row.endedAt || !row.waitEndsAt || !isRunning(row, now)) return row;
  const [updated] = await db
    .update(focusSessions)
    .set({ waitEndsAt: null })
    .where(and(eq(focusSessions.id, row.id), isNull(focusSessions.endedAt)))
    .returning();
  return updated ?? (await getFocus(db, ownerId, row.id));
}

/** What the reader's browser is told about a session: the times, and the milliseconds left by the server's clock. */
export function focusJson(s: FocusRow, now = new Date()) {
  return {
    id: s.id,
    bookId: s.bookId,
    kind: s.kind,
    question: s.question,
    minutes: s.minutes,
    noteId: s.noteId,
    startedAt: s.startedAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    remainingMs: Math.max(0, s.endsAt.getTime() - now.getTime()),
    waitEndsAt: s.waitEndsAt?.toISOString() ?? null,
    waitRemainingMs: s.waitEndsAt ? Math.max(0, s.waitEndsAt.getTime() - now.getTime()) : null,
    /** How long a wait to leave early lasts, so the page says "the 10-minute wait" from the server's own setting. */
    waitMs: waitMs(s.kind),
    running: isRunning(s, now),
    endedHow: s.endedHow,
  };
}

export type FocusJson = ReturnType<typeof focusJson>;

/**
 * focusJson, and for a whole book (M26 R5) also every id the book goes by (the reader's two editions), the book's
 * own page, and whether the reader has reached its last page by the server's reckoning.
 */
export async function focusView(db: Db, ownerId: string, s: FocusRow, now = new Date()) {
  const base = focusJson(s, now);
  if (s.kind !== "book") return base;
  const { ids, homeId } = await bookFamily(db, ownerId, s.bookId);
  const finished = await bookFinished(db, ownerId, s);
  // A book read to its end no longer locks anything, though it stays open until its question is answered.
  return { ...base, running: base.running && !finished, bookIds: ids, homeId, finished };
}

/** A book's text edition and its scan count as one book: the reader moves between them (M25). */
async function sameBook(db: Db, ownerId: string, a: string, b: string) {
  if (a === b) return true;
  const rows = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.ownerId, ownerId), or(and(eq(books.id, a), eq(books.editionOf, b)), and(eq(books.id, b), eq(books.editionOf, a)))));
  return rows.length > 0;
}

/**
 * For the routes that serve a book's file or audio: 423 Locked while a session runs on another book, so a tab
 * left open on that book cannot go on reading it; null when the request may go ahead.
 */
export async function lockedOut(db: Db, ownerId: string, bookId: string | null): Promise<Response | null> {
  if (!bookId) return null;
  const running = await runningFocus(db, ownerId);
  if (!running || (await sameBook(db, ownerId, running.bookId, bookId))) return null;
  return Response.json(
    { error: "A focus session is running on another book. This book opens again when it ends.", focusBookId: running.bookId },
    { status: 423, headers: { "cache-control": "no-store" } },
  );
}

/**
 * The same for /api/files, by the stored file's key: only book files (books/...) are locked, not covers or
 * pictures. The book is looked up only while a session runs, so other times cost one read.
 */
export async function lockedOutOfFile(db: Db, ownerId: string, key: string): Promise<Response | null> {
  if (!key.startsWith("books/") || !(await runningFocus(db, ownerId))) return null;
  return lockedOut(db, ownerId, await bookOfFile(db, ownerId, key));
}

async function bookOfFile(db: Db, ownerId: string, key: string): Promise<string | null> {
  const [row] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.ownerId, ownerId), eq(books.fileKey, key)));
  return row?.id ?? null;
}
