import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, focusSessions } from "@/lib/db/schema";
import { getBook } from "@/lib/library/paths";
import { cleanMinutes, cleanQuestion, MAX_MINUTES, MIN_MINUTES } from "@/lib/reader/focus-session";

export { focusRedirect } from "./focus-redirect";

/**
 * A focus session you cannot walk away from (M26 R4a). The running session is a row in focus_sessions, so every
 * page on every device can ask "is one running?" and send the reader back to the focused book, and the routes that
 * serve a book's file can refuse another book's (423 Locked). The database keeps one open session per reader.
 *
 * Words used here: a session is *open* until it is ended (ended_at is set); it is *running* while it is open and
 * its time is not up. Only a running session locks anything: once the time is up every page opens again, even if
 * the reader has not yet answered "Did you answer it?" (that waits in the reader, on the focused book).
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

export const isRunning = (s: Pick<FocusRow, "endedAt" | "endsAt">, now = new Date()) => !s.endedAt && s.endsAt.getTime() > now.getTime();

/** The reader's open session, running or with its time up but not yet ended; null when there is none. */
export async function openFocus(db: Db, ownerId: string): Promise<FocusRow | null> {
  const [row] = await db
    .select()
    .from(focusSessions)
    .where(and(eq(focusSessions.ownerId, ownerId), isNull(focusSessions.endedAt)));
  return row ?? null;
}

/** The reader's running session (open, time not up), or null: the one read every locked page makes. */
export async function runningFocus(db: Db, ownerId: string, now = new Date()): Promise<FocusRow | null> {
  const row = await openFocus(db, ownerId);
  return row && isRunning(row, now) ? row : null;
}

/** Sessions whose time ran out while no device was open are closed as "time", so they do not block the next one. */
async function closeTimedOut(db: Db, ownerId: string, now: Date) {
  const timedOut = await db
    .select({ id: focusSessions.id, endsAt: focusSessions.endsAt })
    .from(focusSessions)
    .where(and(eq(focusSessions.ownerId, ownerId), isNull(focusSessions.endedAt), lte(focusSessions.endsAt, now)));
  for (const s of timedOut) {
    await db.update(focusSessions).set({ endedAt: s.endsAt, endedHow: "time" }).where(eq(focusSessions.id, s.id));
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
 * Starts a session on one of the reader's books. Refused (409) while another runs; a session whose time is up
 * but was never ended is closed first.
 */
export async function startFocus(
  db: Db,
  ownerId: string,
  input: { bookId: unknown; question: unknown; minutes: unknown },
  now = new Date(),
  ids: () => string = () => crypto.randomUUID(),
): Promise<FocusRow> {
  const question = cleanQuestion(typeof input.question === "string" ? input.question : "");
  const minutes = cleanMinutes(input.minutes);
  if (!question) throw new FocusError("Write the question you are reading to answer.");
  if (!minutes) throw new FocusError(`Set between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`);
  const found = typeof input.bookId === "string" ? await getBook(db, ownerId, input.bookId) : null;
  if (!found || !found.available.read) throw new FocusError("Book not found.", 404);
  await closeTimedOut(db, ownerId, now);
  const open = await openFocus(db, ownerId);
  if (open) throw new FocusError("A focus session is already running. End it before starting another.", 409);
  try {
    const [row] = await db
      .insert(focusSessions)
      .values({
        id: ids(),
        ownerId,
        bookId: found.book.id,
        kind: "sitting",
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
 * Ends a session: "time" when its time was up, otherwise "answered" (an answer was saved) or "early". Ending one
 * already ended changes nothing, so a retry or a second device is harmless. Null when there is no such session.
 */
export async function endFocus(db: Db, ownerId: string, id: unknown, opts: { answered: boolean }, now = new Date()): Promise<FocusRow | null> {
  const row = await getFocus(db, ownerId, id);
  if (!row || row.endedAt) return row;
  const endedHow = row.endsAt.getTime() - now.getTime() <= ON_TIME_MS ? "time" : opts.answered ? "answered" : "early";
  const [ended] = await db
    .update(focusSessions)
    .set({ endedAt: now, endedHow })
    .where(and(eq(focusSessions.id, row.id), isNull(focusSessions.endedAt)))
    .returning();
  // Another request ended it a moment before: read what that one wrote.
  return ended ?? (await getFocus(db, ownerId, row.id));
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
    running: isRunning(s, now),
    endedHow: s.endedHow,
  };
}

export type FocusJson = ReturnType<typeof focusJson>;

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
