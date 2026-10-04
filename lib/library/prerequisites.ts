import { and, asc, eq, inArray } from "drizzle-orm";
import { estimateCost, generate, listGenerations, type Caps, type Generation, type GenerationRequest } from "@/lib/ai/generate";
import type { TextModel } from "@/lib/ai/model";
import { fill, readPrompt, sha256, splitPrompt } from "@/lib/ai/prompts";
import { steCheck } from "@/lib/ai/ste";
import { steStyleInstruction } from "@/lib/ai/ste-prompt";
import type { Db } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import { getStyles } from "./ai-style";
import { sectionForCfi } from "./annotations";
import { styleStrictness, type Style } from "./levels";

/**
 * "What do I need to know?" (M6): the concepts a chapter assumes, each with a
 * two-line explanation and a link to read more. Stored once per chapter and
 * style like every AI answer (ground rule 5); `prompts/prerequisites.md`.
 * Written in the reader's style for this book: plain English or STE.
 */
export class PrerequisitesError extends Error {}

// About 15,000 tokens: enough for a long chapter, and a known upper cost.
const MAX_CHARS = 60_000;
const MAX_TOKENS = 6000;
const MAX_CONCEPTS = 8;

export const SCHEMA = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          explanation: { type: "string", description: "At most two short sentences." },
          read_more: { type: "string", description: "A short search phrase for an encyclopedia article." },
        },
        required: ["name", "explanation", "read_more"],
        additionalProperties: false,
      },
    },
  },
  required: ["concepts"],
  additionalProperties: false,
};

export type Chapter = { id: string; label: string; chapterIndex: number };

/** The chapter at a place in the book (a CFI) or with a given id. */
export async function chapterFor(db: Db, ownerId: string, bookId: string, at: { cfi: string } | { chapterId: string }): Promise<Chapter> {
  const [book] = await db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book) throw new PrerequisitesError("That chapter was not found.");
  let chapterIndex: number | null = null;
  if ("cfi" in at) {
    const sectionId = await sectionForCfi(db, bookId, at.cfi);
    const [s] = sectionId
      ? await db.select({ chapterIndex: sections.chapterIndex }).from(sections).where(and(eq(sections.bookId, bookId), eq(sections.id, sectionId)))
      : [];
    // At the very top of a chapter (before its first paragraph), use the chapter the CFI points into.
    const spine = /^epubcfi\(\/6\/(\d+)/.exec(at.cfi)?.[1];
    chapterIndex = s?.chapterIndex ?? (spine ? Number(spine) / 2 - 1 : null);
  }
  const [row] = await db
    .select({ id: sections.id, label: sections.label, chapterIndex: sections.chapterIndex })
    .from(sections)
    .where(
      and(
        eq(sections.bookId, bookId),
        eq(sections.kind, "chapter"),
        "cfi" in at ? eq(sections.chapterIndex, chapterIndex ?? -1) : eq(sections.id, at.chapterId),
      ),
    );
  if (!row) throw new PrerequisitesError("That chapter was not found.");
  return row;
}

/** The chapter's text (headings and paragraphs), capped so the cost has a known ceiling. */
export async function chapterText(db: Db, bookId: string, chapter: Chapter) {
  const parts = await db
    .select({ kind: sections.kind, label: sections.label, text: sections.text })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.chapterIndex, chapter.chapterIndex), inArray(sections.kind, ["section", "paragraph"])))
    .orderBy(asc(sections.position));
  const text = parts
    .map((p) => (p.kind === "section" ? p.label : p.text))
    .join("\n\n")
    .slice(0, MAX_CHARS);
  if (!text.trim()) throw new PrerequisitesError("This chapter has no text to read.");
  return text;
}

/** How AI explanations are worded: plain English, or STE at a strictness (with Samuel's skill). */
export async function styleInstruction(style: Style) {
  const strictness = styleStrictness(style);
  return {
    text: strictness ? await steStyleInstruction(strictness) : "Write in plain, precise English.",
    promptSuffix: strictness ? " + ste-style + ste/SKILL + ste/substitutions" : "",
  };
}

/** Scores machine-written text in an STE style with the checker (full-STE score); null for plain English. */
export function steScore(style: Style, texts: string[]) {
  if (style === "plain" || !texts.length) return null;
  const r = steCheck(texts.join("\n\n"));
  return { score: r.compliance, errors: r.errors, warnings: r.warnings };
}

export async function bookLine(db: Db, bookId: string) {
  const [book] = await db.select({ title: books.title, author: books.author }).from(books).where(eq(books.id, bookId));
  return book.author ? `${book.title}, by ${book.author}` : book.title;
}

async function buildRequest(db: Db, ownerId: string, bookId: string, chapter: Chapter, style: Style): Promise<GenerationRequest> {
  const text = await chapterText(db, bookId, chapter);
  const file = await readPrompt("prerequisites");
  const instruction = await styleInstruction(style);
  const { system, user } = splitPrompt(file);
  return {
    ownerId,
    bookId,
    sectionId: chapter.id,
    kind: "prerequisites",
    options: { style },
    promptName: `prerequisites${instruction.promptSuffix}`,
    promptHash: sha256(`${file}\n\n${instruction.text}`),
    input: text,
    system: fill(system, { style: instruction.text }),
    prompt: fill(user, { book: await bookLine(db, bookId), chapter: chapter.label, text }),
    maxTokens: MAX_TOKENS,
    effort: "medium",
    schema: SCHEMA,
  };
}

export type Concept = { name: string; explanation: string; readMore: string };
export type PrerequisitesView = Generation & {
  style: Style;
  concepts: Concept[];
  /** STE only: the checker's full-STE score on the explanations. */
  ste: { score: number; errors: number; warnings: number } | null;
};

const readMoreUrl = (q: string) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`;

/** The stored JSON as a list of concepts, each with a link to read more. */
export function viewPrerequisites(g: Generation): PrerequisitesView {
  let concepts: Concept[] = [];
  try {
    const data = JSON.parse(g.output) as { concepts?: { name?: unknown; explanation?: unknown; read_more?: unknown }[] };
    concepts = (data.concepts ?? [])
      .filter((c) => typeof c?.name === "string" && typeof c.explanation === "string" && c.name.trim())
      .slice(0, MAX_CONCEPTS)
      .map((c) => ({
        name: String(c.name).trim(),
        explanation: String(c.explanation).trim(),
        readMore: readMoreUrl(typeof c.read_more === "string" && c.read_more.trim() ? c.read_more : String(c.name)),
      }));
  } catch {
    // Not JSON (should not happen with structured output): show nothing rather than garbage.
  }
  const style = (g.options?.style as Style | undefined) ?? "plain";
  return { ...g, style, concepts, ste: steScore(style, concepts.map((c) => c.explanation)) };
}

export async function needToKnow(
  db: Db,
  model: TextModel,
  ownerId: string,
  input: { bookId: string; chapterId: string; fresh?: boolean },
  opts: { caps?: Caps; now?: () => Date } = {},
) {
  const chapter = await chapterFor(db, ownerId, input.bookId, { chapterId: input.chapterId });
  const { effective } = await getStyles(db, ownerId, input.bookId);
  const out = await generate(db, model, await buildRequest(db, ownerId, input.bookId, chapter, effective), { ...opts, fresh: input.fresh });
  return { ...out, generation: viewPrerequisites(out.generation) };
}

export async function estimateNeedToKnow(db: Db, model: TextModel, ownerId: string, bookId: string, chapter: Chapter) {
  const { effective } = await getStyles(db, ownerId, bookId);
  return estimateCost(model, await buildRequest(db, ownerId, bookId, chapter, effective));
}

/** Every stored answer for a chapter, oldest first. */
export const listNeedToKnow = async (db: Db, ownerId: string, bookId: string, chapterId: string) =>
  (await listGenerations(db, ownerId, bookId, chapterId, "prerequisites")).map(viewPrerequisites);
