import { and, asc, eq, inArray } from "drizzle-orm";
import { estimateCost, generate, toGeneration, type Caps, type Generation, type GenerationRequest } from "@/lib/ai/generate";
import type { TextModel } from "@/lib/ai/model";
import { fill, readPrompt, sha256, splitPrompt } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { books, generations, sections } from "@/lib/db/schema";
import { getStyles } from "./ai-style";
import { bookLine, steScore, styleInstruction } from "./prerequisites";
import type { Style } from "./levels";
import { isOwnBook } from "@/lib/library/own-book";

/**
 * A paper's summary card (M41 R4a): the question it asks, its method, its main finding and its limits, one to three
 * sentences each, written by AI from the paper's start and end (a paper's abstract and introduction open it, its
 * discussion and conclusions close it; the middle is given by its section titles), so a long review is read for a
 * known, small cost. Stored once per paper and style like every AI answer; asked again only on purpose.
 */
export class PaperSummaryError extends Error {}

/** About 9,000 tokens in all: the start, then the end. */
const HEAD_CHARS = 22_000;
const TAIL_CHARS = 14_000;
const MAX_TOKENS = 1200;

export const SCHEMA = {
  type: "object",
  properties: {
    question: { type: "string" },
    method: { type: "string" },
    finding: { type: "string" },
    limits: { type: "string" },
  },
  required: ["question", "method", "finding", "limits"],
  additionalProperties: false,
};

export type SummaryCard = { question: string; method: string; finding: string; limits: string };

async function ownPaper(db: Db, ownerId: string, bookId: string) {
  const [book] = await db
    .select({ id: books.id, kind: books.kind })
    .from(books)
    .where(isOwnBook(bookId, ownerId));
  if (!book) throw new PaperSummaryError("Book not found");
  if (book.kind !== "paper") throw new PaperSummaryError("Mark this title as a paper first (its DOI or PubMed ID).");
  return book;
}

/** The paper's text as the card reads it: its start, its middle sections' titles, its end. */
export async function paperText(db: Db, bookId: string): Promise<string> {
  const parts = await db
    .select({ kind: sections.kind, label: sections.label, text: sections.text, form: sections.form })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), inArray(sections.kind, ["chapter", "section", "paragraph"])))
    .orderBy(asc(sections.position));
  const lines = parts.filter((p) => p.kind !== "paragraph" || p.form === "prose").map((p) => (p.kind === "paragraph" ? p.text : `## ${p.label}`));
  const all = lines.join("\n\n");
  if (!all.trim()) throw new PaperSummaryError("This paper has no text to read yet.");
  if (all.length <= HEAD_CHARS + TAIL_CHARS) return all;
  // The start and the end whole; the middle by its headings only.
  let head = "";
  let i = 0;
  while (i < lines.length && head.length + lines[i].length < HEAD_CHARS) head += `${lines[i++]}\n\n`;
  let tail = "";
  let j = lines.length - 1;
  while (j >= i && tail.length + lines[j].length < TAIL_CHARS) tail = `${lines[j--]}\n\n${tail}`;
  const headings = lines.slice(i, j + 1).filter((l) => l.startsWith("## "));
  return `${head}[… the middle of the paper, by its section titles:]\n${headings.join("\n")}\n[…]\n\n${tail}`.trim();
}

async function buildRequest(db: Db, ownerId: string, bookId: string, style: Style): Promise<GenerationRequest> {
  const text = await paperText(db, bookId);
  const file = await readPrompt("paper-summary");
  const instruction = await styleInstruction(style);
  const { system, user } = splitPrompt(file);
  return {
    ownerId,
    bookId,
    sectionId: null,
    kind: "paper-summary",
    options: { style },
    promptName: `paper-summary${instruction.promptSuffix}`,
    promptHash: sha256(`${file}\n\n${instruction.text}`),
    input: text,
    system: fill(system, { style: instruction.text }),
    prompt: fill(user, { book: await bookLine(db, bookId), text }),
    maxTokens: MAX_TOKENS,
    effort: "medium",
    schema: SCHEMA,
  };
}

export type SummaryView = Generation & { style: Style; card: SummaryCard | null; ste: { score: number; errors: number; warnings: number } | null };

export function viewSummary(g: Generation): SummaryView {
  let card: SummaryCard | null = null;
  try {
    const d = JSON.parse(g.output) as Partial<Record<keyof SummaryCard, unknown>>;
    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const c = { question: s(d.question), method: s(d.method), finding: s(d.finding), limits: s(d.limits) };
    card = c.question || c.finding ? c : null;
  } catch {
    // Not JSON (should not happen with structured output): show nothing rather than garbage.
  }
  const style = (g.options?.style as Style | undefined) ?? "plain";
  return { ...g, style, card, ste: card ? steScore(style, Object.values(card)) : null };
}

export async function summariseCard(
  db: Db,
  model: TextModel,
  ownerId: string,
  input: { bookId: string; fresh?: boolean },
  opts: { caps?: Caps; now?: () => Date } = {},
) {
  await ownPaper(db, ownerId, input.bookId);
  const { effective } = await getStyles(db, ownerId, input.bookId);
  const out = await generate(db, model, await buildRequest(db, ownerId, input.bookId, effective), { ...opts, fresh: input.fresh });
  return { ...out, generation: viewSummary(out.generation) };
}

export async function estimateSummary(db: Db, model: TextModel, ownerId: string, bookId: string) {
  await ownPaper(db, ownerId, bookId);
  const { effective } = await getStyles(db, ownerId, bookId);
  return estimateCost(model, await buildRequest(db, ownerId, bookId, effective));
}

/** Every stored card for this paper, oldest first. */
export async function listSummaries(db: Db, ownerId: string, bookId: string) {
  await ownPaper(db, ownerId, bookId);
  const rows = await db
    .select()
    .from(generations)
    .where(and(eq(generations.ownerId, ownerId), eq(generations.bookId, bookId), eq(generations.kind, "paper-summary")))
    .orderBy(asc(generations.createdAt), asc(generations.id));
  return rows.map(toGeneration).map(viewSummary);
}
