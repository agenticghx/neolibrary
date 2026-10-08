import { and, asc, eq, isNull } from "drizzle-orm";
import { capsFromEnv, spending, SpendingCapReached, type Caps } from "@/lib/ai/generate";
import type { Db } from "@/lib/db/client";
import { audioTracks, books, sections } from "@/lib/db/schema";
import { SpeechError, speechCost, usdPer1kChars, type SpeechModel, type Voice } from "@/lib/speech/model";
import type { Storage } from "@/lib/storage";
import { AudioError, cacheKeyOf, speakPassage } from "./audio";

/**
 * Whole-book AI narration (M14 follow-up V5; Samuel's decision of 2026-10-06,
 * PROGRESS.md Open unknowns row 11). Chosen on purpose on the Import page: a
 * made voice reads every paragraph of an EPUB now, in reading order, and each
 * one is saved exactly as the Listen bar saves it (speakPassage), so the whole
 * book then plays for free. It is paid up front, so the page first states the
 * whole book, its paragraphs and the cost, and nothing starts without
 * `confirm: true`.
 *
 * No new table. A paragraph is "saved in a voice" when speakPassage would
 * serve it again instead of paying for it: its owner has a track with its key
 * (cacheKeyOf: the voice and the paragraph's text). Progress is that count
 * over the book's paragraphs, read from the database, so it survives a
 * restart. Whether a run is going on lives in this server's memory only:
 * after a restart (a deploy) none is, and the page offers to continue; saved
 * paragraphs are skipped, so nothing is paid for twice.
 *
 * The voice spending limits (VOICE_CAP_PER_BOOK_USD, VOICE_CAP_PER_MONTH_USD)
 * stop a run: speakPassage checks them before every paragraph it pays for.
 *
 * Samuel's rule (CLAUDE.md): never call ElevenLabs (or any paid voice) to
 * narrate a whole book until he explicitly says so. The tests use the fake
 * voice only. So only the library's owner may start one, for now
 * (mayNarrateWholeBooks, below).
 */

/**
 * Who may start whole-book narration, and see what it would cost: the
 * library's owner (the admin, Samuel) only, for now (2026-10-07). His own tick
 * and Create is his explicit say-so; an invited reader's is a case he has not
 * ruled on (PROGRESS.md Open unknowns row 13), and on the live site one
 * ElevenLabs key pays for everyone, within the shared limits. The narration
 * route refuses anyone else (403, with OWNER_ONLY); the Import page shows them
 * OWNER_ONLY instead of the form. Stop is never refused to a book's owner: it
 * can only save money. The functions below do not check the role themselves:
 * the route is their only caller.
 */
export const OWNER_ONLY = "Whole-book narration is for the library's owner, for now.";
export const mayNarrateWholeBooks = (user: { role: string }) => user.role === "admin";

export class NarrationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
  }
}

export type NarrationStop = {
  /** finished: every paragraph is saved; stopped: Stop was pressed; limit: a spending limit (its own words); error: the voice or the book failed. */
  kind: "finished" | "stopped" | "limit" | "error";
  message: string;
};

export type NarrationSummary = {
  book: { id: string; title: string; author: string };
  /** The voice this summary is about, and the voices on offer. */
  voice: string;
  voices: Voice[];
  /** The whole book: its paragraphs and characters, and what all of it costs. */
  paragraphs: number;
  characters: number;
  totalUsd: number;
  /** The price used: US dollars per 1,000 characters (ELEVENLABS_USD_PER_1K_CHARS; $0.30 unless set). */
  usdPer1kChars: number;
  /** Paragraphs already saved in this voice: free, never paid for again. */
  saved: number;
  /** What is left to make, and what it costs: the amount paid up front if the run goes to the end. */
  toMake: { paragraphs: number; characters: number };
  estimateUsd: number;
  /** The voice spending limits, and what has been spent: this month by everyone (one key pays), and on this book ever. */
  caps: { perBookUsd: number; perMonthUsd: number; spentBookUsd: number; spentMonthUsd: number };
  /** If the limits would stop a run before the end: how many paragraphs would be saved by then. Null when they allow the rest. */
  stopsAt: number | null;
  running: boolean;
  /** Stop was pressed; the paragraph being made is still being saved. */
  stopping: boolean;
  /** Why the last run in this server stopped; null when none has (or one is running). */
  stoppedBecause: NarrationStop | null;
};

/** What a run needs; tests pass the fake voice, their own limits, and may wrap speakPassage to count its calls. */
export type NarrationDeps = {
  db: Db;
  storage: Storage;
  model: SpeechModel;
  caps?: Caps;
  now?: () => Date;
  speak?: typeof speakPassage;
};

type Job = {
  ownerId: string;
  bookId: string;
  voice: string;
  /** The book's title and the voice's name, for the refusal of a second run while this one goes on. */
  title: string;
  voiceName: string;
  running: boolean;
  stopRequested: boolean;
  /** Paragraphs this run paid for. */
  made: number;
  stoppedBecause: NarrationStop | null;
  done: Promise<void>;
};

// One list per server process, on globalThis: the Import page and the narration route may load this module separately.
const g = globalThis as unknown as { __neolibraryNarrations?: Map<string, Job> };
const jobs = () => (g.__neolibraryNarrations ??= new Map<string, Job>());
const jobKey = (ownerId: string, bookId: string, voice: string) => `${ownerId}|${bookId}|${voice}`;

/** The owner's book, if it is an EPUB with its file (an AI voice cannot be lined up with a PDF page yet). */
async function epubOf(db: Db, ownerId: string, bookId: string) {
  const [book] = await db
    .select({ id: books.id, title: books.title, author: books.author, fileKey: books.fileKey, fileType: books.fileType })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId), isNull(books.deletedAt)));
  if (!book) throw new NarrationError("Book not found", 404);
  if (!book.fileKey) throw new NarrationError("This book has no file yet: add its EPUB first.");
  if (book.fileType !== "epub") throw new NarrationError("Only an EPUB can be narrated by an AI voice: a voice cannot be lined up with a PDF page yet.");
  return book;
}

/** The book's paragraphs in reading order. */
async function paragraphsOf(db: Db, bookId: string) {
  const list = await db
    .select({ id: sections.id, text: sections.text })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph")))
    .orderBy(asc(sections.position));
  if (!list.length) throw new NarrationError("There is nothing to read aloud in this book.");
  return list;
}

/** The keys of the owner's tracks in this voice (in any book): a paragraph whose key is here is served again, free. */
async function savedKeys(db: Db, ownerId: string, voice: string) {
  const rows = await db
    .selectDistinct({ key: audioTracks.cacheKey })
    .from(audioTracks)
    .where(and(eq(audioTracks.ownerId, ownerId), eq(audioTracks.voice, voice)));
  return new Set(rows.map((r) => r.key));
}

async function voiceOf(model: SpeechModel, voice: string | null | undefined) {
  const voices = await model.voices();
  const id = voice || voices[0]?.id;
  if (!id || !voices.some((v) => v.id === id)) throw new NarrationError("Choose one of the voices on offer.");
  return { voices, voice: id };
}

/**
 * Where the limits would stop a run, checked as speakPassage checks them
 * before each paragraph it pays for (what has been spent, plus this
 * paragraph's cost, against each limit): the number of the book's paragraphs
 * saved by then, or null when the limits allow every paragraph left. A
 * paragraph's cost is its characters at the price, which is what both voices
 * bill (lib/speech).
 */
export function limitStop(
  list: { key: string; characters: number }[],
  saved: ReadonlySet<string>,
  spent: { book: number; month: number },
  caps: Caps,
): number | null {
  const have = new Set(saved);
  let { book, month } = spent;
  for (const p of list) {
    if (have.has(p.key)) continue;
    const cost = speechCost(p.characters);
    if (month + cost > caps.perMonthUsd || book + cost > caps.perBookUsd) return list.filter((q) => have.has(q.key)).length;
    month += cost;
    book += cost;
    have.add(p.key);
  }
  return null;
}

/** What narrating the whole book in `voice` (or the first voice on offer) involves now: GET /api/books/[id]/narration. */
export async function narrationSummary(
  db: Db,
  model: SpeechModel,
  ownerId: string,
  bookId: string,
  voiceAsked: string | null,
  opts: { caps?: Caps; now?: () => Date } = {},
): Promise<NarrationSummary> {
  const book = await epubOf(db, ownerId, bookId);
  const { voices, voice } = await voiceOf(model, voiceAsked);
  const list = (await paragraphsOf(db, bookId)).map((p) => ({ key: cacheKeyOf(model, voice, p.text), characters: p.text.length }));
  const saved = await savedKeys(db, ownerId, voice);
  // Every paragraph not saved yet, at its characters × the price: the same sum as the whole book's cost, so the two agree
  // when nothing is saved. Two paragraphs with the same text are made once (the second is served again), so for a book
  // with repeated paragraphs this is a few cents high (Frankenstein: $131.64 against $131.60): on the cautious side.
  const left = list.filter((p) => !saved.has(p.key));
  const characters = list.reduce((n, p) => n + p.characters, 0);
  const leftCharacters = left.reduce((n, p) => n + p.characters, 0);
  const caps = opts.caps ?? capsFromEnv(process.env, "VOICE");
  const spent = await spending(db, model.provider, bookId, opts.now?.() ?? new Date());
  const job = jobs().get(jobKey(ownerId, bookId, voice));
  const savedCount = list.filter((p) => saved.has(p.key)).length;
  return {
    book: { id: book.id, title: book.title, author: book.author },
    voice,
    voices,
    paragraphs: list.length,
    characters,
    totalUsd: speechCost(characters),
    usdPer1kChars: usdPer1kChars(),
    saved: savedCount,
    toMake: { paragraphs: list.length - savedCount, characters: leftCharacters },
    estimateUsd: speechCost(leftCharacters),
    caps: { perBookUsd: caps.perBookUsd, perMonthUsd: caps.perMonthUsd, spentBookUsd: spent.book, spentMonthUsd: spent.month },
    stopsAt: limitStop(list, saved, spent, caps),
    running: job?.running ?? false,
    stopping: !!job?.running && job.stopRequested,
    stoppedBecause: job && !job.running ? job.stoppedBecause : null,
  };
}

/**
 * Starts narrating the whole book in `voice`, in the background, unless that
 * is already going on (then it carries on; nothing new starts). Refused unless
 * `confirm` is exactly true: the reader ticked "I understand this makes
 * narration for the entire book and costs about $X". `done` settles when the
 * run stops, for whatever reason (it never rejects).
 *
 * One run per reader at a time (review of #100): a run of another book, or of
 * this book in another voice, is refused while one goes on. The Import page
 * shows one run (with its Stop), so a second would go on unseen. Paid
 * paragraphs reserve their estimate first (`reserveSpend`), so two callers
 * at the same moment cannot both pass a spending cap that only one of them
 * fits.
 */
export async function startNarration(
  deps: NarrationDeps,
  ownerId: string,
  bookId: string,
  voiceAsked: string,
  confirm: unknown,
): Promise<{ started: boolean; done: Promise<void> }> {
  const book = await epubOf(deps.db, ownerId, bookId);
  if (confirm !== true) throw new NarrationError("Nothing was started: first confirm that this makes narration for the entire book, paid up front.");
  if (!voiceAsked) throw new NarrationError("Choose one of the voices on offer.");
  const { voices, voice } = await voiceOf(deps.model, voiceAsked);
  // No await between looking and adding: two requests at once start one run.
  const key = jobKey(ownerId, bookId, voice);
  const going = jobs().get(key);
  if (going?.running) return { started: false, done: going.done };
  const other = [...jobs().values()].find((j) => j.ownerId === ownerId && j.running);
  if (other) throw new NarrationError(`A narration is already going on: ${other.title}, in the voice ${other.voiceName}. Stop it first.`);
  const voiceName = voices.find((v) => v.id === voice)?.name ?? voice;
  const job: Job = {
    ownerId,
    bookId,
    voice,
    title: book.title,
    voiceName,
    running: true,
    stopRequested: false,
    made: 0,
    stoppedBecause: null,
    done: Promise.resolve(),
  };
  jobs().set(key, job);
  job.done = run(job, deps);
  return { started: true, done: job.done };
}

async function run(job: Job, deps: NarrationDeps) {
  const speak = deps.speak ?? speakPassage;
  const end = (kind: NarrationStop["kind"], message: string) => {
    job.running = false;
    job.stoppedBecause = { kind, message };
  };
  try {
    const list = await paragraphsOf(deps.db, job.bookId);
    const saved = await savedKeys(deps.db, job.ownerId, job.voice);
    for (const p of list) {
      if (job.stopRequested) return end("stopped", "Stopped, as you asked.");
      const key = cacheKeyOf(deps.model, job.voice, p.text);
      // Saved already (made earlier, by the Listen bar, or by a run before a restart): free, and never paid for again.
      if (saved.has(key)) continue;
      const out = await speak(deps.db, deps.storage, deps.model, job.ownerId, { bookId: job.bookId, sectionId: p.id, voice: job.voice }, { caps: deps.caps, now: deps.now });
      saved.add(key);
      if (!out.reused) job.made += 1;
    }
    end("finished", "Every paragraph is saved in this voice.");
  } catch (e) {
    if (e instanceof SpendingCapReached) end("limit", e.message);
    else if (e instanceof SpeechError || e instanceof AudioError || e instanceof NarrationError) end("error", e.message);
    else {
      console.error("Whole-book narration stopped by an error:", e);
      end("error", "Something went wrong on the server.");
    }
  }
}

/**
 * Asks the run to stop, and waits (up to `waitMs`) for the paragraph being
 * made: it is paid for already, so it is saved, then the run ends. Only the
 * book's owner reaches their own run.
 */
export async function stopNarration(db: Db, ownerId: string, bookId: string, voice: string, waitMs = 10_000) {
  await epubOf(db, ownerId, bookId);
  const job = jobs().get(jobKey(ownerId, bookId, voice));
  if (!job?.running) return;
  job.stopRequested = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([job.done, new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)))]);
  clearTimeout(timer);
}

/** The owner's run going on in this server, if any (one at a time: see startNarration); the Import page shows it when it opens. */
export function runningNarrations(ownerId: string) {
  return [...jobs().values()].filter((j) => j.ownerId === ownerId && j.running).map((j) => ({ bookId: j.bookId, voice: j.voice }));
}

/** Forgets every run, as a server restart does (tests only; a run still going keeps going). */
export function forgetNarrationsForTests() {
  jobs().clear();
}
