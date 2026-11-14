/**
 * M41 R6: storing and serving a paper's figures redrawn on the laptop (see
 * lib/library/figure-redraw.ts for how a redraw is made and checked).
 *
 * Each redraw is a `generations` row, kind "figure-redraw", one per place a
 * picture appears: `section_id` is "<chapter file>#<n>" (the n-th picture of
 * that chapter, counted from 0), `output` the drawing, `options` the picture's
 * path and the check's figures. Rows are never changed: sending a redraw again
 * adds a newer row, and the newest is shown. The library's owner only sends
 * them; a reader the paper is shared with sees the owner's.
 */
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { readPrompt, sha256 } from "@/lib/ai/prompts";
import { generationCacheKey } from "@/lib/ai/generate";
import type { Db } from "@/lib/db/client";
import { books, generations } from "@/lib/db/schema";
import type { Storage } from "@/lib/storage";
import { checkSvg, FigureError, figuresOf, REDRAW_KIND, REDRAW_PROMPT, TRANSCRIBE_PROMPT } from "./figure-redraw";
import { SUBSCRIPTION_PROVIDER } from "./text-edition";
import { isOwnBook } from "@/lib/library/own-book";

export const MAX_FIGURES_A_PART = 200;
const bytesHash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export class FigureRedrawError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** The fingerprint of the instructions a redraw must have been made with: both prompt files, as the laptop script hashes them. */
export async function redrawPromptHash() {
  return sha256(`${await readPrompt(TRANSCRIBE_PROMPT)}\n${await readPrompt(REDRAW_PROMPT)}`);
}

export type SentFigure = {
  chapter: string;
  nth: number;
  src: string;
  inputHash: string;
  svg: string;
  model: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  check: { tolerance: number; missed: number; extra: number; wordsAstray: number; rounds: number; reviewedBy: string };
};

const isShare = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

/**
 * Redraws sent by the laptop script, checked here before anything is stored: the book is the owner's own EPUB; each
 * figure is the n-th picture of that chapter in the book's file, with these very bytes (its fingerprint); the drawing
 * holds only plain drawing; it was made with this server's instructions and passed its checks.
 */
export async function saveFigureRedraws(deps: { db: Db; storage: Storage; now?: () => Date }, ownerId: string, bookId: string, input: { figures?: unknown }) {
  const { db, storage } = deps;
  const [book] = await db
    .select({ fileKey: books.fileKey, fileType: books.fileType, sharedFrom: books.sharedFrom, deletedAt: books.deletedAt })
    .from(books)
    .where(isOwnBook(bookId, ownerId));
  if (!book || book.deletedAt || !book.fileKey) throw new FigureRedrawError("Book not found.", 404);
  if (book.sharedFrom) throw new FigureRedrawError("This paper is shared with you; only its owner can send redrawn figures.", 403);
  if (book.fileType !== "epub") throw new FigureRedrawError("Only an EPUB's figures can be redrawn.");
  const list = Array.isArray(input.figures) ? input.figures : null;
  if (!list?.length) throw new FigureRedrawError("Send { figures: [...] }.");
  if (list.length > MAX_FIGURES_A_PART) throw new FigureRedrawError(`Send at most ${MAX_FIGURES_A_PART} figures at a time.`, 413);
  const file = await storage.get(book.fileKey);
  if (!file) throw new FigureRedrawError("The book's file is missing.", 404);
  const pictures = figuresOf(file.data);
  const promptHash = await redrawPromptHash();
  const valid = list.map((raw, i): SentFigure => {
    const f = (raw ?? {}) as Partial<SentFigure>;
    const bad = (why: string) => new FigureRedrawError(`Figure ${i + 1} sent: ${why}`);
    if (typeof f.chapter !== "string" || !Number.isInteger(f.nth) || typeof f.src !== "string") throw bad("its chapter, place and picture are missing.");
    const picture = pictures.find((p) => p.src === f.src);
    if (!picture || !picture.spots.some((s) => s.chapter === f.chapter && s.nth === f.nth)) throw bad(`this book has no picture ${f.src} at picture ${f.nth} of ${f.chapter}.`);
    if (f.inputHash !== bytesHash(picture.bytes)) throw bad("it was made from another picture than this book's.");
    if (typeof f.model !== "string" || !/^claude-[a-z0-9-]+$/.test(f.model)) throw bad("the model must be a Claude model.");
    if (f.promptHash !== promptHash) throw bad("it was made with other instructions than prompts/figure-transcribe.md and figure-redraw.md on this server.");
    if (!isCount(f.inputTokens) || !isCount(f.outputTokens)) throw bad("the token counts are missing.");
    const c = (f.check ?? {}) as Partial<SentFigure["check"]>;
    if (!isShare(c.missed) || !isShare(c.extra) || !isShare(c.wordsAstray) || !isCount(c.tolerance) || !isCount(c.rounds) || typeof c.reviewedBy !== "string") throw bad("its check's figures are missing.");
    let svg: string;
    try {
      svg = checkSvg(String(f.svg ?? ""));
    } catch (e) {
      if (e instanceof FigureError) throw bad(e.message);
      throw e;
    }
    return { chapter: f.chapter, nth: f.nth!, src: f.src, inputHash: f.inputHash, svg, model: f.model, promptHash, inputTokens: f.inputTokens!, outputTokens: f.outputTokens!, check: c as SentFigure["check"] };
  });
  const now = deps.now?.() ?? new Date();
  let saved = 0;
  for (const f of valid) {
    const sectionId = `${f.chapter}#${f.nth}`;
    // Options are strings (the column is typed so): the check's figures as JSON.
    const options = { src: f.src, chapter: f.chapter, nth: String(f.nth), via: "subscription", check: JSON.stringify(f.check) };
    const newest = (await listRows(db, ownerId, bookId)).filter((r) => r.sectionId === sectionId).at(-1);
    if (newest?.output === f.svg) continue; // sent again: nothing new
    await db.insert(generations).values({
      ownerId,
      bookId,
      sectionId,
      kind: REDRAW_KIND,
      options,
      cacheKey: generationCacheKey(REDRAW_KIND, { src: f.src, place: sectionId }, promptHash, `${f.inputHash}:${now.toISOString()}`),
      provider: SUBSCRIPTION_PROVIDER,
      model: f.model,
      promptName: REDRAW_PROMPT,
      promptHash,
      inputHash: f.inputHash,
      inputTokens: f.inputTokens,
      outputTokens: f.outputTokens,
      costUsd: 0,
      output: f.svg,
      createdAt: now,
    });
    saved++;
  }
  return { saved, figures: valid.length };
}

const listRows = (db: Db, ownerId: string, bookId: string) =>
  db
    .select({ id: generations.id, sectionId: generations.sectionId, output: generations.output, model: generations.model, createdAt: generations.createdAt })
    .from(generations)
    .where(and(eq(generations.ownerId, ownerId), eq(generations.bookId, bookId), eq(generations.kind, REDRAW_KIND)))
    .orderBy(asc(generations.createdAt), asc(generations.id));

export type ReaderFigure = { chapter: string; nth: number; id: string; model: string; at: string };

/** The paper whose redraws a reader sees: their own book, or the owner's when the paper is shared with them. */
async function sourceOf(db: Db, book: { id: string; ownerId: string; sharedFrom: string | null }) {
  if (!book.sharedFrom) return { ownerId: book.ownerId, bookId: book.id };
  const [src] = await db.select({ ownerId: books.ownerId }).from(books).where(eq(books.id, book.sharedFrom));
  return src ? { ownerId: src.ownerId, bookId: book.sharedFrom } : null;
}

/** The newest redraw of each figure, for the reader (not the drawings themselves: each is fetched as a picture). */
export async function figureRedrawsFor(db: Db, book: { id: string; ownerId: string; sharedFrom: string | null }): Promise<ReaderFigure[]> {
  const src = await sourceOf(db, book);
  if (!src) return [];
  const newest = new Map<string, ReaderFigure>();
  // Without the drawings: the reader fetches each one as a picture, and loading every version's here made opening a
  // paper wait on all of them (audit 2026-11-09).
  const rows = await db
    .select({ id: generations.id, sectionId: generations.sectionId, model: generations.model, createdAt: generations.createdAt })
    .from(generations)
    .where(and(eq(generations.ownerId, src.ownerId), eq(generations.bookId, src.bookId), eq(generations.kind, REDRAW_KIND)))
    .orderBy(asc(generations.createdAt), asc(generations.id));
  for (const r of rows) {
    const m = /^(.+)#(\d+)$/.exec(r.sectionId ?? "");
    if (m) newest.set(r.sectionId!, { chapter: m[1], nth: Number(m[2]), id: r.id, model: r.model, at: r.createdAt.toISOString() });
  }
  return [...newest.values()];
}

/** One redraw's drawing, if it belongs to this book (or, for a shared paper, to the paper it was shared from). */
export async function figureRedrawSvg(db: Db, book: { id: string; ownerId: string; sharedFrom: string | null }, id: string): Promise<string | null> {
  const src = await sourceOf(db, book);
  if (!src || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [row] = await db
    .select({ output: generations.output })
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.ownerId, src.ownerId), eq(generations.bookId, src.bookId), eq(generations.kind, REDRAW_KIND)));
  return row?.output ?? null;
}
