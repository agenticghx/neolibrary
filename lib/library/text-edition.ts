/**
 * M25: a scanned PDF read by Claude, page by page, through the Message
 * Batches API, to make its flowing text edition (docs/scan-to-text-plan.md).
 *
 * - The owner starts it on purpose: nothing starts without `confirm: true`,
 *   and only when the estimate fits beside the book's and the month's AI
 *   limits (no limit is raised). Owner only, like whole-book narration.
 * - Preparing: the server draws each page, skips pages with almost no ink
 *   (nothing to read, nothing for the model to invent) and pages already read
 *   with these instructions, and sends the rest in batches of at most
 *   `batchChars` characters of pictures (Anthropic takes 256 MB a batch).
 * - Waiting: Anthropic answers within 24 hours. The batch numbers are in the
 *   `text_edition_jobs` table, so a restart loses nothing: `pollTextEditions`
 *   runs at start-up and every minute, picks up a preparation a restart cut
 *   short, and saves each answer as a `generations` row (kind 'transcribe'),
 *   with its provenance and cost, at the batch price. A page Claude declined
 *   or could not finish is listed as not read; one cut off is billed and
 *   recorded as kind 'transcribe-failed', so it counts toward the limits but
 *   is never served as text.
 * - Every page read is compared with the scan's own hidden text
 *   (lib/library/page-check.ts); pages that disagree are listed for a look.
 * - Stop cancels the batches: pages not yet read are not charged.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getBatchModel } from "@/lib/ai";
import { batchCostUsd, type BatchRequest, type BatchResult, type TextBatchModel } from "@/lib/ai/batch";
import { capsFromEnv, generationCacheKey, spendingWithJobs, usd, type Caps } from "@/lib/ai/generate";
import { readPrompt, sha256 } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { books, generations, sections, textEditionJobs, type TextEditionBatch, type TextEditionCheck, type TextEditionProblem } from "@/lib/db/schema";
import type { Storage } from "@/lib/storage";
import { checkPage } from "./page-check";
import { readBook } from "./ebook";
import { buildSections } from "./sections-store";
import { buildTextEdition, type EditionPage } from "./text-epub";
import { BLANK_INK, openPdfForPictures, pictureTokens, MAX_PICTURE_TOKENS } from "./page-pictures";

export const TRANSCRIBE_KIND = "transcribe";
export const TRANSCRIBE_FAILED_KIND = "transcribe-failed";
export const PROMPT_NAME = "transcribe-page";
/** Upper limit on each page's answer, thinking included (a dense page with a table used about 1,100). */
export const MAX_TOKENS = 8000;
/** Pictures per batch, in characters of base64: well under Anthropic's 256 MB a batch. */
export const BATCH_CHARS = 150 * 1024 * 1024;

export const OWNER_ONLY = "Text editions are for the library's owner, for now.";
export const mayMakeTextEditions = (user: { role: string }) => user.role === "admin";

export class TextEditionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * A page's estimated cost, generous so the limits err on the safe side: the
 * largest picture Claude takes, the instructions, and a long answer. Measured
 * on five pages of The Pay Off: about 4,270 tokens in and 700 out.
 */
export const pageEstimateUsd = (model: string) => batchCostUsd(model, MAX_PICTURE_TOKENS + 400, 1000);

export const pageSectionId = (page: number) => `page-${page}`;
const pageOf = (sectionId: string | null) => Number(/^page-(\d+)$/.exec(sectionId ?? "")?.[1] ?? NaN);

export type TextEditionDeps = {
  db: Db;
  storage: Storage;
  model: TextBatchModel;
  caps?: Caps;
  now?: () => Date;
  batchChars?: number;
};

type JobRow = typeof textEditionJobs.$inferSelect;
const ACTIVE = ["preparing", "waiting"] as const;

export type TextEditionJobView = {
  id: string;
  status: JobRow["status"];
  stopRequested: boolean;
  pageCount: number;
  /** Pages sent to Claude so far, and how many of them came back read. */
  sent: number;
  read: number;
  blankPages: number[];
  problems: TextEditionProblem[];
  /** Pages whose reading disagrees with the scan's hidden text, for a look. */
  toCheck: { page: number; agreement: number | null }[];
  message: string;
  createdAt: string;
  endedAt: string | null;
};

export type TextEditionSummary = {
  bookId: string;
  title: string;
  pageCount: number;
  /** Pages that need no reading: read already with these instructions (free to use again), or blank. */
  done: number;
  estimateUsd: number;
  caps: Caps;
  /** Spent on this book and this month, plus what jobs going on hold. */
  spent: { book: number; month: number };
  /** Null when the estimate fits beside the limits; else why it does not. */
  overLimit: string | null;
  job: TextEditionJobView | null;
  /** The text edition made so far (a book of its own), to open in the reader. */
  editionId: string | null;
};

/** The owner's book, if it is a PDF with its file. */
async function pdfOf(db: Db, ownerId: string, bookId: string) {
  const [book] = await db
    .select({ id: books.id, title: books.title, fileKey: books.fileKey, fileType: books.fileType, pageCount: books.pageCount })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId), isNull(books.deletedAt)));
  if (!book) throw new TextEditionError("Book not found", 404);
  if (!book.fileKey) throw new TextEditionError("This book has no file yet: add its PDF first.");
  if (book.fileType !== "pdf") throw new TextEditionError("Only a scanned PDF can be read into a text edition.");
  return book;
}

async function prompt() {
  const text = await readPrompt(PROMPT_NAME);
  return { text, hash: sha256(text) };
}

/** Pages of this book already read with these instructions by this model. */
async function donePages(db: Db, ownerId: string, bookId: string, model: string, promptHash: string) {
  const rows = await db
    .selectDistinct({ sectionId: generations.sectionId })
    .from(generations)
    .where(
      and(
        eq(generations.ownerId, ownerId),
        eq(generations.bookId, bookId),
        eq(generations.kind, TRANSCRIBE_KIND),
        eq(generations.model, model),
        eq(generations.promptHash, promptHash),
      ),
    );
  return new Set(rows.map((r) => pageOf(r.sectionId)).filter(Number.isFinite));
}

/** Pages earlier jobs found blank: nothing to read there, now or later. */
async function blankPagesOf(db: Db, ownerId: string, bookId: string) {
  const rows = await db
    .select({ blank: textEditionJobs.blankPages })
    .from(textEditionJobs)
    .where(and(eq(textEditionJobs.ownerId, ownerId), eq(textEditionJobs.bookId, bookId)));
  return new Set(rows.flatMap((r) => r.blank));
}

/** Pages that need no reading: read before with these instructions, or blank. */
async function settledPages(db: Db, ownerId: string, bookId: string, model: string, promptHash: string) {
  return new Set([...(await donePages(db, ownerId, bookId, model, promptHash)), ...(await blankPagesOf(db, ownerId, bookId))]);
}

async function pageCountOf(db: Db, book: { id: string; pageCount: number | null }) {
  if (book.pageCount) return book.pageCount;
  const [last] = await db
    .select({ index: sections.chapterIndex })
    .from(sections)
    .where(eq(sections.bookId, book.id))
    .orderBy(desc(sections.chapterIndex))
    .limit(1);
  return last ? last.index + 1 : 0;
}

/** The scan's own hidden text on one page (from the book's sections), for the page check. */
async function hiddenTextOf(db: Db, bookId: string, page: number) {
  const rows = await db
    .select({ text: sections.text })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph"), eq(sections.chapterIndex, page - 1)))
    .orderBy(asc(sections.position));
  return rows.map((r) => r.text).join("\n");
}

async function latestJob(db: Db, ownerId: string, bookId: string) {
  const [job] = await db
    .select()
    .from(textEditionJobs)
    .where(and(eq(textEditionJobs.ownerId, ownerId), eq(textEditionJobs.bookId, bookId)))
    .orderBy(desc(textEditionJobs.createdAt))
    .limit(1);
  return job ?? null;
}

async function readCount(db: Db, job: JobRow) {
  const rows = await db
    .selectDistinct({ sectionId: generations.sectionId })
    .from(generations)
    .where(
      and(
        eq(generations.ownerId, job.ownerId),
        eq(generations.bookId, job.bookId),
        eq(generations.kind, TRANSCRIBE_KIND),
        eq(generations.promptHash, job.promptHash),
        inArray(
          generations.sectionId,
          job.batches.flatMap((b) => b.pages.map(pageSectionId)).concat(["-"]),
        ),
      ),
    );
  return rows.length;
}

async function view(db: Db, job: JobRow): Promise<TextEditionJobView> {
  return {
    id: job.id,
    status: job.status,
    stopRequested: job.stopRequested,
    pageCount: job.pageCount,
    sent: job.batches.reduce((n, b) => n + b.pages.length, 0),
    read: await readCount(db, job),
    blankPages: job.blankPages,
    problems: job.problems,
    toCheck: job.checks.filter((c) => c.flagged).map(({ page, agreement }) => ({ page, agreement })),
    message: job.message,
    createdAt: job.createdAt.toISOString(),
    endedAt: job.endedAt?.toISOString() ?? null,
  };
}

/** What reading the book involves, before anything is sent: pages, cost, the limits, and the latest job. */
export async function textEditionSummary(deps: TextEditionDeps, ownerId: string, bookId: string): Promise<TextEditionSummary> {
  const { db } = deps;
  const book = await pdfOf(db, ownerId, bookId);
  const caps = deps.caps ?? capsFromEnv();
  const { hash } = await prompt();
  const pageCount = await pageCountOf(db, book);
  const done = (await settledPages(db, ownerId, bookId, deps.model.model, hash)).size;
  const estimateUsd = pageEstimateUsd(deps.model.model) * Math.max(0, pageCount - done);
  const spent = await spendingWithJobs(db, deps.model.provider, bookId, deps.now?.() ?? new Date());
  const job = await latestJob(db, ownerId, bookId);
  const active = job && (ACTIVE as readonly string[]).includes(job.status);
  let overLimit: string | null = null;
  if (!active) {
    if (spent.book + estimateUsd > caps.perBookUsd)
      overLimit = `Reading the ${pageCount - done} pages left costs up to ${usd(estimateUsd)}, more than this book's AI limit allows (${usd(caps.perBookUsd)}, with ${usd(spent.book)} spent). The owner can raise AI_CAP_PER_BOOK_USD.`;
    else if (spent.month + estimateUsd > caps.perMonthUsd)
      overLimit = `Reading the ${pageCount - done} pages left costs up to ${usd(estimateUsd)}, more than this month's AI limit allows (${usd(caps.perMonthUsd)}, with ${usd(spent.month)} spent). It resets on the 1st, or the owner can raise AI_CAP_PER_MONTH_USD.`;
  }
  const edition = await editionOf(db, ownerId, bookId);
  return { bookId, title: book.title, pageCount, done, estimateUsd, caps, spent, overLimit, job: job ? await view(db, job) : null, editionId: edition?.id ?? null };
}

// Each job's row is changed by one thing at a time in this server: preparing appends batches while the poll marks them stored.
const g = globalThis as unknown as { __neolibraryTextJobLocks?: Map<string, Promise<void>>; __neolibraryTextPreparing?: Map<string, Promise<void>> };
const locks = () => (g.__neolibraryTextJobLocks ??= new Map());
const preparing = () => (g.__neolibraryTextPreparing ??= new Map());

async function changeJob(db: Db, jobId: string, change: (job: JobRow) => Partial<JobRow> | Promise<Partial<JobRow>>) {
  const prev = locks().get(jobId) ?? Promise.resolve();
  let result: JobRow | undefined;
  const run = prev.then(async () => {
    const [job] = await db.select().from(textEditionJobs).where(eq(textEditionJobs.id, jobId));
    if (!job) return;
    const patch = await change(job);
    [result] = await db
      .update(textEditionJobs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(textEditionJobs.id, jobId))
      .returning();
  });
  locks().set(jobId, run.catch(() => {}));
  await run;
  return result;
}

/**
 * Starts reading the book's pages. Throws without `confirm === true`, when a
 * job is already going on for the book, or when the estimate does not fit
 * beside the limits. Returns at once; preparing goes on in the background
 * (`done` settles when every batch is sent).
 */
export async function startTextEdition(deps: TextEditionDeps, ownerId: string, bookId: string, confirm: unknown) {
  const { db } = deps;
  if (confirm !== true) throw new TextEditionError("Nothing was started: first confirm that Claude reads every page of this book, paid up front.");
  const summary = await textEditionSummary(deps, ownerId, bookId);
  if (summary.job && (ACTIVE as readonly string[]).includes(summary.job.status)) return { started: false, jobId: summary.job.id, done: preparing().get(summary.job.id) ?? Promise.resolve() };
  if (summary.overLimit) throw new TextEditionError(summary.overLimit, 402);
  if (summary.done >= summary.pageCount) throw new TextEditionError("Every page of this book has been read already.");
  const { hash } = await prompt();
  let job: JobRow;
  try {
    [job] = await db
      .insert(textEditionJobs)
      .values({
        ownerId,
        bookId,
        provider: deps.model.provider,
        model: deps.model.model,
        promptHash: hash,
        status: "preparing",
        pageCount: summary.pageCount,
        estimateUsd: summary.estimateUsd,
        createdAt: deps.now?.() ?? new Date(),
      })
      .returning();
  } catch (e) {
    // Two starts at once: the database lets one job per book go on.
    const going = await latestJob(db, ownerId, bookId);
    if (going && (ACTIVE as readonly string[]).includes(going.status)) return { started: false, jobId: going.id, done: preparing().get(going.id) ?? Promise.resolve() };
    throw e;
  }
  return { started: true, jobId: job.id, done: prepareInBackground(deps, job.id) };
}

function prepareInBackground(deps: TextEditionDeps, jobId: string) {
  const going = preparing().get(jobId);
  if (going) return going;
  const done = prepare(deps, jobId).finally(() => preparing().delete(jobId));
  preparing().set(jobId, done);
  return done;
}

async function prepare(deps: TextEditionDeps, jobId: string) {
  const { db } = deps;
  const [job] = await db.select().from(textEditionJobs).where(eq(textEditionJobs.id, jobId));
  if (!job || job.status !== "preparing") return;
  let doc: Awaited<ReturnType<typeof openPdfForPictures>> | null = null;
  try {
    const [book] = await db.select({ fileKey: books.fileKey }).from(books).where(eq(books.id, job.bookId));
    const file = book?.fileKey ? await deps.storage.get(book.fileKey) : null;
    if (!file) throw new TextEditionError("The book's file could not be read.");
    doc = await openPdfForPictures(file.data);
    const { text: instructions } = await prompt();
    const skip = new Set([...job.batches.flatMap((b) => b.pages), ...(await settledPages(db, job.ownerId, job.bookId, job.model, job.promptHash))]);
    const limit = deps.batchChars ?? BATCH_CHARS;
    let chunk: { request: BatchRequest; page: number; hash: string }[] = [];
    let chars = 0;
    const send = async () => {
      if (!chunk.length) return;
      const batchId = await deps.model.submit(chunk.map((c) => c.request));
      const batch: TextEditionBatch = { id: batchId, pages: chunk.map((c) => c.page), hashes: chunk.map((c) => c.hash), stored: false };
      await changeJob(db, jobId, (j) => ({ batches: [...j.batches, batch] }));
      chunk = [];
      chars = 0;
    };
    const blank: number[] = [];
    for (let page = 1; page <= doc.pageCount; page++) {
      const [now] = await db.select({ stop: textEditionJobs.stopRequested }).from(textEditionJobs).where(eq(textEditionJobs.id, jobId));
      if (now?.stop) break;
      if (skip.has(page)) continue;
      const picture = await doc.picture(page);
      if (picture.ink < BLANK_INK) {
        blank.push(page);
        continue;
      }
      if (pictureTokens(picture.width, picture.height) > MAX_PICTURE_TOKENS) throw new TextEditionError(`Page ${page} came out larger than Claude takes.`);
      const base64 = picture.png.toString("base64");
      chunk.push({ request: { id: pageSectionId(page), images: [{ mediaType: "image/png", base64 }], prompt: instructions, maxTokens: MAX_TOKENS }, page, hash: sha256(base64) });
      chars += base64.length;
      if (chars >= limit) await send();
    }
    await send();
    await changeJob(db, jobId, (j) => ({ blankPages: [...new Set([...j.blankPages, ...blank])].sort((a, b) => a - b), status: "waiting" }));
  } catch (e) {
    const message = e instanceof TextEditionError ? e.message : "Something went wrong on the server while the pages were being drawn.";
    if (!(e instanceof TextEditionError)) console.error("Text edition: preparing stopped by an error:", e);
    // Batches already sent are paid for as they are answered: keep waiting for them.
    await changeJob(db, jobId, (j) =>
      j.batches.length ? { status: "waiting", message } : { status: "failed", message, endedAt: deps.now?.() ?? new Date() },
    );
  } finally {
    await doc?.close();
  }
}

/** Saves a finished batch's answers: each page read as a generations row, with its check; the rest as problems. */
async function storeBatch(deps: TextEditionDeps, job: JobRow, batch: TextEditionBatch, results: BatchResult[]) {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const hashOf = new Map(batch.pages.map((p, i) => [p, batch.hashes[i]]));
  const problems: TextEditionProblem[] = [];
  const checks: TextEditionCheck[] = [];
  for (const r of results) {
    const page = pageOf(r.id);
    if (!batch.pages.includes(page)) continue;
    const inputHash = hashOf.get(page) ?? "";
    const options = { model: job.model };
    if (r.kind === "succeeded") {
      const cacheKey = generationCacheKey(TRANSCRIBE_KIND, options, job.promptHash, inputHash);
      const [already] = await db
        .select({ id: generations.id })
        .from(generations)
        .where(and(eq(generations.ownerId, job.ownerId), eq(generations.cacheKey, cacheKey), eq(generations.bookId, job.bookId)));
      if (!already) {
        await db.insert(generations).values({
          ownerId: job.ownerId,
          bookId: job.bookId,
          sectionId: pageSectionId(page),
          kind: TRANSCRIBE_KIND,
          options,
          cacheKey,
          provider: job.provider,
          model: r.model,
          promptName: PROMPT_NAME,
          promptHash: job.promptHash,
          inputHash,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costUsd: batchCostUsd(r.model, r.inputTokens, r.outputTokens),
          output: r.text,
          createdAt: now,
        });
      }
      checks.push({ page, ...checkPage(r.text, await hiddenTextOf(db, job.bookId, page)) });
    } else {
      const message =
        r.kind === "refused" || r.kind === "errored"
          ? r.message
          : r.kind === "canceled"
            ? "Not read: stopped before Claude reached it (not charged)."
            : "Not read: Anthropic ran out of time (not charged).";
      problems.push({ page, kind: r.kind, message });
      // A refused or cut-off answer that ran is billed: count it toward the limits, never serve it as text.
      if ((r.kind === "refused" || r.kind === "errored") && r.inputTokens) {
        await db.insert(generations).values({
          ownerId: job.ownerId,
          bookId: job.bookId,
          sectionId: pageSectionId(page),
          kind: TRANSCRIBE_FAILED_KIND,
          options,
          cacheKey: generationCacheKey(TRANSCRIBE_FAILED_KIND, options, job.promptHash, `${inputHash}:${batch.id}`),
          provider: job.provider,
          model: r.model ?? job.model,
          promptName: PROMPT_NAME,
          promptHash: job.promptHash,
          inputHash,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens ?? 0,
          costUsd: batchCostUsd(r.model ?? job.model, r.inputTokens, r.outputTokens ?? 0),
          output: "",
          createdAt: now,
        });
      }
    }
  }
  await changeJob(db, job.id, (j) => ({
    batches: j.batches.map((b) => (b.id === batch.id ? { ...b, stored: true } : b)),
    problems: [...j.problems.filter((p) => !batch.pages.includes(p.page)), ...problems].sort((a, b) => a.page - b.page),
    checks: [...j.checks.filter((c) => !batch.pages.includes(c.page)), ...checks].sort((a, b) => a.page - b.page),
  }));
}

/** The text edition of a scan, if one has been made: a book of its own, linked by `edition_of`. */
export async function editionOf(db: Db, ownerId: string, scanId: string) {
  const [edition] = await db
    .select({ id: books.id, fileKey: books.fileKey })
    .from(books)
    .where(and(eq(books.ownerId, ownerId), eq(books.editionOf, scanId)));
  return edition ?? null;
}

/**
 * Makes (or makes again) a scan's text edition from every page read so far:
 * the newest reading of each page, blank pages left out, pages not read marked
 * as such. The edition is a book of its own (an EPUB linked to the scan by
 * `edition_of`, hidden from the library's lists), so its paragraphs, Listen,
 * notes, rewrites, search and place work as in any EPUB; made again, it keeps
 * its id, so its notes and place stay. Returns its id, or null when no page
 * has been read.
 */
export async function makeTextEdition(deps: Pick<TextEditionDeps, "db" | "storage" | "now">, ownerId: string, scanId: string) {
  const { db } = deps;
  const [scan] = await db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      language: books.language,
      publisher: books.publisher,
      description: books.description,
      pageCount: books.pageCount,
      coverKey: books.coverKey,
      coverSource: books.coverSource,
    })
    .from(books)
    .where(and(eq(books.id, scanId), eq(books.ownerId, ownerId)));
  if (!scan) throw new TextEditionError("Book not found", 404);
  const rows = await db
    .select({ sectionId: generations.sectionId, output: generations.output, model: generations.model })
    .from(generations)
    .where(and(eq(generations.ownerId, ownerId), eq(generations.bookId, scanId), eq(generations.kind, TRANSCRIBE_KIND)))
    .orderBy(asc(generations.createdAt), asc(generations.id));
  const newest = new Map<number, { output: string; model: string }>();
  for (const r of rows) newest.set(pageOf(r.sectionId), r); // later rows replace earlier ones
  if (!newest.size) return null;
  const jobs = await db
    .select({ checks: textEditionJobs.checks, pageCount: textEditionJobs.pageCount })
    .from(textEditionJobs)
    .where(and(eq(textEditionJobs.ownerId, ownerId), eq(textEditionJobs.bookId, scanId)))
    .orderBy(asc(textEditionJobs.createdAt));
  const flagged = new Map<number, boolean>();
  for (const j of jobs) for (const c of j.checks) flagged.set(c.page, c.flagged);
  const blank = await blankPagesOf(db, ownerId, scanId);
  const pageCount = Math.max(scan.pageCount ?? 0, ...jobs.map((j) => j.pageCount), ...newest.keys());
  const pages: EditionPage[] = Array.from({ length: pageCount }, (_, i) => {
    const page = i + 1;
    const r = newest.get(page);
    return r ? { page, kind: "read", markdown: r.output } : blank.has(page) ? { page, kind: "blank" } : { page, kind: "unread" };
  });
  const madeAt = deps.now?.() ?? new Date();
  const models = [...new Set([...newest.values()].map((r) => r.model))].join(" and ");
  const existing = await editionOf(db, ownerId, scanId);
  const id = existing?.id ?? crypto.randomUUID();
  const epub = buildTextEdition(pages, {
    bookId: id,
    title: scan.title,
    author: scan.author,
    language: scan.language,
    model: models,
    madeAt,
    toCheck: [...flagged].filter(([, f]) => f).map(([p]) => p).sort((a, b) => a - b),
  });
  const fileName = `${scan.title} (text edition).epub`.slice(0, 255);
  const info = await readBook(epub, fileName);
  const fileKey = `books/${ownerId}/${id}.epub`;
  await deps.storage.put(fileKey, epub, "application/epub+zip");
  const values = {
    title: scan.title,
    author: scan.author,
    fileKey,
    fileName,
    fileType: "epub" as const,
    fileSize: epub.byteLength,
    // The scan's cover, shared (the edition is never shown on its own in the library).
    coverKey: scan.coverKey,
    coverSource: scan.coverSource,
    language: scan.language,
    publisher: scan.publisher,
    description: scan.description,
    toc: info.toc,
    updatedAt: madeAt,
  };
  if (existing) await db.update(books).set(values).where(eq(books.id, id));
  else await db.insert(books).values({ id, ownerId, editionOf: scanId, createdAt: madeAt, ...values });
  await buildSections(db, id, epub, info.toc, "epub");
  return id;
}

/** Ends a job whose batches are all sent and saved, and makes the text edition from what was read. */
async function finishIfDone(deps: TextEditionDeps, jobId: string) {
  let ended = false;
  const job = await changeJob(deps.db, jobId, async (j) => {
    if (j.status !== "waiting" || j.batches.some((b) => !b.stored)) return {};
    ended = true;
    const view = await (async () => {
      const read = await readCount(deps.db, j);
      const toCheck = j.checks.filter((c) => c.flagged).length;
      return `${read} page${read === 1 ? "" : "s"} read, ${j.blankPages.length} blank, ${j.problems.length} not read, ${toCheck} to check.`;
    })();
    const why = j.message ? `${j.message} ` : "";
    return { status: j.stopRequested ? "stopped" : "finished", message: `${j.stopRequested ? "Stopped, as you asked. " : why}${view}`, endedAt: deps.now?.() ?? new Date() };
  });
  if (!ended || !job) return;
  try {
    await makeTextEdition(deps, job.ownerId, job.bookId);
  } catch (e) {
    console.error("Text edition: making the EPUB failed:", e);
    await changeJob(deps.db, jobId, (j) => ({ message: `${j.message} The text edition could not be made.` }));
  }
}

/**
 * Checks every job going on: picks up a preparation a restart cut short,
 * saves the answers of each batch that has ended, and ends a job whose
 * batches are all saved. Runs at start-up and every minute.
 */
export async function pollTextEditions(deps: TextEditionDeps) {
  const jobs = await deps.db.select().from(textEditionJobs).where(inArray(textEditionJobs.status, [...ACTIVE]));
  for (const job of jobs) {
    if (job.status === "preparing" && !preparing().has(job.id)) void prepareInBackground(deps, job.id);
    for (const batch of job.batches.filter((b) => !b.stored)) {
      const status = await deps.model.status(batch.id);
      if (status.state !== "ended") continue;
      await storeBatch(deps, job, batch, await deps.model.results(batch.id));
    }
    await finishIfDone(deps, job.id);
  }
}

/** Stops the book's job: no more pages are sent, and batches still going are cancelled (pages not read are not charged). */
export async function stopTextEdition(deps: TextEditionDeps, ownerId: string, bookId: string) {
  await pdfOf(deps.db, ownerId, bookId);
  const job = await latestJob(deps.db, ownerId, bookId);
  if (!job || !(ACTIVE as readonly string[]).includes(job.status)) return;
  await changeJob(deps.db, job.id, () => ({ stopRequested: true }));
  // Preparing checks the flag before each page; once it has sent its last batch, cancel every batch still going.
  await preparing().get(job.id);
  const [now] = await deps.db.select().from(textEditionJobs).where(eq(textEditionJobs.id, job.id));
  for (const batch of (now ?? job).batches.filter((b) => !b.stored)) await deps.model.cancel(batch.id);
}

/**
 * Checks on jobs going on soon after start-up, then every minute
 * (TEXT_EDITION_POLL_MS to change it): a batch is answered within 24 hours,
 * so a minute's delay costs nothing. Does nothing while no job is going on.
 */
export function scheduleTextEditionPolls(getDb: () => Promise<Db>, getStorage: () => Promise<Storage>, env: Record<string, string | undefined> = process.env) {
  if (env.VITEST) return;
  const every = Number(env.TEXT_EDITION_POLL_MS) > 0 ? Number(env.TEXT_EDITION_POLL_MS) : 60_000;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const db = await getDb();
      const [going] = await db.select({ id: textEditionJobs.id }).from(textEditionJobs).where(inArray(textEditionJobs.status, [...ACTIVE])).limit(1);
      if (going) await pollTextEditions({ db, storage: await getStorage(), model: getBatchModel(env) });
    } catch (e) {
      console.error("Text editions: checking the batches failed:", e);
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, Math.min(every, 5_000)).unref?.();
  setInterval(tick, every).unref?.();
}

/** Forgets what this server keeps in memory, as a restart does (tests only). */
export function forgetTextEditionsForTests() {
  locks().clear();
  preparing().clear();
}
