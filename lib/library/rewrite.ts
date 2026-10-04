import { and, eq } from "drizzle-orm";
import { generate, listGenerations, estimateCost, type Caps, type Generation, type GenerationRequest } from "@/lib/ai/generate";
import type { TextModel } from "@/lib/ai/model";
import { fill, readPrompt, sha256, splitPrompt } from "@/lib/ai/prompts";
import { steCheck } from "@/lib/ai/ste";
import { steSkill } from "@/lib/ai/ste-prompt";
import type { Db } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import { sectionForCfi } from "./annotations";

/**
 * Rewrite one paragraph at a level (M6). Every rewrite is a stored version;
 * the book's own text is never changed. Prompts: `prompts/rewrite.md` plus
 * one instruction file per level in `prompts/rewrite-levels/`; STE uses
 * `prompts/ste-rewrite.md` with Samuel's STE skill (`prompts/ste/`).
 */
export { isLevel, LEVELS, STRICTNESS, strictnessFrom, type Level, type Strictness } from "./levels";
import { LEVELS, STRICTNESS, type Level, type Strictness } from "./levels";

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

async function buildRequest(
  db: Db,
  ownerId: string,
  bookId: string,
  sectionId: string,
  level: Level,
  strictness: Strictness,
): Promise<GenerationRequest> {
  const paragraph = await paragraphFor(db, ownerId, bookId, { sectionId });
  const [book] = await db.select({ title: books.title, author: books.author }).from(books).where(eq(books.id, bookId));
  const message = {
    book: book.author ? `${book.title}, by ${book.author}` : book.title,
    chapter: paragraph.chapter,
    text: paragraph.text,
  };
  const common = { ownerId, bookId, sectionId, kind: "rewrite", input: paragraph.text, maxTokens: MAX_TOKENS, effort: "low" as const };

  if (level === "ste") {
    const file = await readPrompt("ste-rewrite");
    const { skill, substitutions } = await steSkill();
    const { system, user } = splitPrompt(file);
    return {
      ...common,
      options: { level, strictness },
      promptName: "ste-rewrite + ste/SKILL + ste/substitutions",
      promptHash: sha256(`${file}\n\n${skill}\n\n${substitutions}`),
      system: fill(system, { skill, substitutions, strictness: STRICTNESS[strictness] }),
      prompt: fill(user, { ...message, task: `Rewrite (STE, ${STRICTNESS[strictness]})` }),
    };
  }

  const base = await readPrompt("rewrite");
  const instruction = (await readPrompt(`rewrite-levels/${level}`)).trim();
  const { system, user } = splitPrompt(base);
  return {
    ...common,
    options: { level },
    promptName: `rewrite + rewrite-levels/${level}`,
    promptHash: sha256(`${base}\n\n${instruction}`),
    system: fill(system, { instruction }),
    prompt: fill(user, { ...message, task: `Rewrite (${LEVELS[level]})` }),
  };
}

/** Rewrites a paragraph, or re-serves the stored rewrite. `fresh` asks again for a new version. */
export async function rewriteParagraph(
  db: Db,
  model: TextModel,
  ownerId: string,
  input: { bookId: string; sectionId: string; level: Level; strictness?: Strictness; fresh?: boolean },
  opts: { caps?: Caps; now?: () => Date } = {},
) {
  const req = await buildRequest(db, ownerId, input.bookId, input.sectionId, input.level, input.strictness ?? "standard");
  return generate(db, model, req, { ...opts, fresh: input.fresh });
}

/** The rough cost of a rewrite, shown before asking (ground rule 8). */
export async function estimateRewrite(db: Db, model: TextModel, ownerId: string, bookId: string, sectionId: string, level: Level) {
  return estimateCost(model, await buildRequest(db, ownerId, bookId, sectionId, level, "standard"));
}

export type RewriteView = Generation & {
  /** The rewrite itself, without the notes. */
  text: string;
  /** STE only: places where the original could be read two ways, and the reading chosen. */
  meaningChanges: string[];
  /** STE only: the checker's result on the rewrite (always measured against full STE). */
  ste: { score: number; errors: number; warnings: number; sentences: number } | null;
};

/** Splits the stored answer into the rewrite and its notes, and scores STE rewrites with the checker. */
export function viewRewrite(g: Generation): RewriteView {
  const [text, notes = ""] = g.output.split(/^---notes---[ \t]*$/m);
  const meaningChanges = notes
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
  const clean = text.trim();
  if (g.options.level !== "ste") return { ...g, text: clean, meaningChanges: [], ste: null };
  const r = steCheck(clean);
  return { ...g, text: clean, meaningChanges, ste: { score: r.compliance, errors: r.errors, warnings: r.warnings, sentences: r.sentences } };
}

export const listRewrites = async (db: Db, ownerId: string, bookId: string, sectionId: string) =>
  (await listGenerations(db, ownerId, bookId, sectionId, "rewrite")).map(viewRewrite);
