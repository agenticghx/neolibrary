import { and, eq } from "drizzle-orm";
import { generate, listGenerations, estimateCost, type Caps } from "@/lib/ai/generate";
import type { TextModel } from "@/lib/ai/model";
import { fill, readPrompt, sha256, splitPrompt } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import { sectionForCfi } from "./annotations";

/**
 * Rewrite one paragraph at a level (M6). Every rewrite is a stored version;
 * the book's own text is never changed. Prompts: `prompts/rewrite.md` plus
 * one instruction file per level in `prompts/rewrite-levels/`.
 */
export const LEVELS = {
  plain: "Plain English",
  biologist: "For a biologist",
  background: "Add missing background",
  shorter: "Shorter",
} as const;
export type Level = keyof typeof LEVELS;
export const isLevel = (v: unknown): v is Level => typeof v === "string" && v in LEVELS;

export class RewriteError extends Error {}

const MAX_TOKENS = 4000;

export type Paragraph = { id: string; text: string; cfi: string; chapter: string };

/** The paragraph at a place in the book (a CFI, e.g. where text is selected) or with a given id. */
export async function paragraphFor(
  db: Db,
  ownerId: string,
  bookId: string,
  at: { cfi: string } | { sectionId: string },
): Promise<Paragraph> {
  const [book] = await db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book) throw new RewriteError("That paragraph was not found.");
  const sectionId = "cfi" in at ? await sectionForCfi(db, bookId, at.cfi) : at.sectionId;
  const [row] = sectionId
    ? await db
        .select({ id: sections.id, text: sections.text, cfi: sections.cfi, kind: sections.kind, chapterIndex: sections.chapterIndex })
        .from(sections)
        .where(and(eq(sections.bookId, bookId), eq(sections.id, sectionId)))
    : [];
  if (!row) throw new RewriteError("That paragraph was not found.");
  if (row.kind !== "paragraph" || !row.text.trim()) throw new RewriteError("Only paragraphs of text can be rewritten.");
  const [chapter] = await db
    .select({ label: sections.label })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "chapter"), eq(sections.chapterIndex, row.chapterIndex)));
  return { id: row.id, text: row.text, cfi: row.cfi, chapter: chapter?.label ?? "" };
}

async function buildRequest(db: Db, ownerId: string, bookId: string, sectionId: string, level: Level) {
  const paragraph = await paragraphFor(db, ownerId, bookId, { sectionId });
  const [book] = await db.select({ title: books.title, author: books.author }).from(books).where(eq(books.id, bookId));
  const base = await readPrompt("rewrite");
  const instruction = (await readPrompt(`rewrite-levels/${level}`)).trim();
  const { system, user } = splitPrompt(base);
  return {
    ownerId,
    bookId,
    sectionId,
    kind: "rewrite",
    options: { level },
    promptName: `rewrite + rewrite-levels/${level}`,
    promptHash: sha256(`${base}\n\n${instruction}`),
    input: paragraph.text,
    system: fill(system, { instruction }),
    prompt: fill(user, {
      task: `Rewrite (${LEVELS[level]})`,
      book: book.author ? `${book.title}, by ${book.author}` : book.title,
      chapter: paragraph.chapter,
      text: paragraph.text,
    }),
    maxTokens: MAX_TOKENS,
    effort: "low" as const,
  };
}

/** Rewrites a paragraph, or re-serves the stored rewrite. `fresh` asks again for a new version. */
export async function rewriteParagraph(
  db: Db,
  model: TextModel,
  ownerId: string,
  input: { bookId: string; sectionId: string; level: Level; fresh?: boolean },
  opts: { caps?: Caps; now?: () => Date } = {},
) {
  const req = await buildRequest(db, ownerId, input.bookId, input.sectionId, input.level);
  return generate(db, model, req, { ...opts, fresh: input.fresh });
}

/** The rough cost of a rewrite, shown before asking (ground rule 8). */
export async function estimateRewrite(db: Db, model: TextModel, ownerId: string, bookId: string, sectionId: string, level: Level) {
  return estimateCost(model, await buildRequest(db, ownerId, bookId, sectionId, level));
}

export const listRewrites = (db: Db, ownerId: string, bookId: string, sectionId: string) =>
  listGenerations(db, ownerId, bookId, sectionId, "rewrite");
