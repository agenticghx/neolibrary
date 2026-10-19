/**
 * A focus session with a question (M26 R3). Before starting, the reader writes the question they are reading to
 * answer and sets a timer; while it runs, the reader shows only the page; when the time is up, the app asks
 * "Did you answer it?" and saves the answer as a note. Since M26 R4a the session lives on the server (one at a
 * time per reader, lib/library/focus-lock.ts), so every page on every device knows it runs; this device keeps a
 * copy (localStorage) with its end as a moment on this device's clock, so a reload part-way through, or a moment
 * offline, picks it up with the time that is left.
 *
 * Pure logic lives here, so it can be unit-tested; FocusSession.tsx draws it.
 */
export const DEFAULT_MINUTES = 50;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;

export type FocusSession = {
  /** Shared by every sitting read during the session (the reading tracker reports it). */
  id: string;
  bookId: string;
  question: string;
  minutes: number;
  /** Milliseconds since the epoch. */
  startedAt: number;
  endsAt: number;
  /** The note that will hold the answer: chosen before saving, so a retry saves nothing twice. */
  noteId: string;
};

const KEY = "neolibrary.focus.v1";

/** A whole number of minutes in range, or null for anything else (a blank, letters, 0, 1000). */
export function cleanMinutes(raw: unknown): number | null {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= MIN_MINUTES && n <= MAX_MINUTES ? n : null;
}

/** A question is one line: blank or spaces only is no question. */
export const cleanQuestion = (raw: string) => raw.replace(/\s+/g, " ").trim().slice(0, 500);

export function startSession(
  input: { bookId: string; question: string; minutes: number },
  now = Date.now(),
  ids: () => string = () => crypto.randomUUID(),
): FocusSession {
  const question = cleanQuestion(input.question);
  const minutes = cleanMinutes(input.minutes);
  if (!question) throw new Error("Write the question you are reading to answer.");
  if (!minutes) throw new Error(`Set between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`);
  return { id: ids(), bookId: input.bookId, question, minutes, startedAt: now, endsAt: now + minutes * 60_000, noteId: ids() };
}

/** What the server says about a session (GET /api/focus): its times, and the milliseconds left by its own clock. */
export type ServerFocus = {
  id: string;
  bookId: string;
  question: string;
  minutes: number;
  noteId: string;
  remainingMs: number;
};

/**
 * The session as this device runs it, from the server's word. Its end is now plus the time the server says is
 * left, so a device whose clock is set wrong still counts down right. A copy already on this device for the same
 * session keeps its own end, so a reload does not shift it by the moments the page took to load.
 */
export function fromServer(s: ServerFocus, local: FocusSession | null, now = Date.now()): FocusSession {
  if (local && local.id === s.id && local.bookId === s.bookId) return { ...local, question: s.question, noteId: s.noteId };
  const endsAt = now + Math.max(0, s.remainingMs);
  return { id: s.id, bookId: s.bookId, question: s.question, minutes: s.minutes, startedAt: endsAt - s.minutes * 60_000, endsAt, noteId: s.noteId };
}

/** Milliseconds left, never below zero. */
export const remainingMs = (s: FocusSession, now = Date.now()) => Math.max(0, s.endsAt - now);

export const isOver = (s: FocusSession, now = Date.now()) => remainingMs(s, now) === 0;

/** "50:00", "9:05", "0:07": minutes and seconds, as a kitchen timer shows them. */
export function formatRemaining(ms: number) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Spoken for a screen reader: "50 minutes left", "1 minute left", "under a minute left". */
export function describeRemaining(ms: number) {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m === 0) return "under a minute left";
  return `${m} ${m === 1 ? "minute" : "minutes"} left`;
}

/** The note that holds the answer: it repeats the question, so the note stands on its own in Notes and in Daily review. */
export function focusNoteBody(question: string, answer: string) {
  const q = cleanQuestion(question);
  const a = answer.trim();
  return q ? `Question: ${q}\n\nAnswer: ${a}` : a;
}

/**
 * The answer part of a focus note, to show under its question on Reading stats (the note repeats the question, so
 * it reads on its own in Notes and Daily review). A note the reader has since rewritten in another shape is shown whole.
 */
export function answerFromNote(body: string) {
  const m = /^Question: [^\n]*\n\nAnswer: ([\s\S]*)$/.exec(body);
  return m ? m[1].trim() : body;
}

/** The session saved on this device for this book, if its shape is right (storage can hold anything). */
export function loadSession(bookId: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): FocusSession | null {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? "null") as Partial<FocusSession> | null;
    if (!raw || typeof raw !== "object" || raw.bookId !== bookId) return null;
    const ok =
      typeof raw.id === "string" &&
      typeof raw.question === "string" &&
      typeof raw.noteId === "string" &&
      typeof raw.minutes === "number" &&
      typeof raw.startedAt === "number" &&
      typeof raw.endsAt === "number" &&
      Number.isFinite(raw.endsAt);
    return ok ? (raw as FocusSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: FocusSession, storage: Pick<Storage, "setItem"> | null = safeStorage()) {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // A private window or full storage: the session still runs, it just will not survive a reload.
  }
}

export function clearSession(storage: Pick<Storage, "removeItem"> | null = safeStorage()) {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
