import { and, asc, eq, gt, lt } from "drizzle-orm";
import { estimateCost, generate, listGenerations, type Caps, type Generation, type GenerationRequest } from "@/lib/ai/generate";
import type { TextModel } from "@/lib/ai/model";
import { fill, readPrompt, sha256, splitPrompt } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import { getStyles } from "./ai-style";
import { sectionForCfi } from "./annotations";
import { bookLine, steScore, styleInstruction } from "./prerequisites";
import type { Style } from "./levels";
import { isOwnBook } from "@/lib/library/own-book";

/**
 * Explain an equation (M41 R4b): a tap on a displayed equation in the reader asks AI what it says, what each symbol
 * stands for here, and how to read it, from its LaTeX (kept in the formula's `alttext` at import, markdown-math.ts)
 * and the paragraphs around it. Stored once per equation and style like every AI answer (ground rule 5); asked again
 * only on purpose. `prompts/explain-math.md`.
 */
export class ExplainMathError extends Error {}

const MAX_LATEX = 2000;
/** Prose paragraphs of context: two before the equation, one after, each cut to this many characters. */
const BEFORE = 2;
const AFTER = 1;
const MAX_PARA = 1500;
const MAX_TOKENS = 900;

export type Equation = { id: string; latex: string; number: string | null };

/** The equation paragraph at a place in the book (a CFI), with the LaTeX the reader's page holds for it. */
export async function equationAt(db: Db, ownerId: string, bookId: string, cfi: string, latex: unknown): Promise<Equation> {
  const [book] = await db.select({ id: books.id }).from(books).where(isOwnBook(bookId, ownerId));
  if (!book) throw new ExplainMathError("Book not found");
  const tex = typeof latex === "string" ? latex.trim() : "";
  if (!tex) throw new ExplainMathError("This equation has no LaTeX to read.");
  if (tex.length > MAX_LATEX) throw new ExplainMathError("This equation is too long to explain.");
  const id = await sectionForCfi(db, bookId, cfi);
  const [row] = id ? await db.select({ id: sections.id, form: sections.form }).from(sections).where(and(eq(sections.bookId, bookId), eq(sections.id, id))) : [];
  if (!row || row.form !== "equation") throw new ExplainMathError("Tap an equation set on its own line to have it explained.");
  return { id: row.id, latex: tex, number: /\\tag\*?\{([^}]{1,12})\}/.exec(tex)?.[1] ?? null };
}

/** The prose just before and after the equation in its chapter. */
async function around(db: Db, bookId: string, sectionId: string) {
  const [at] = await db.select({ position: sections.position, chapterIndex: sections.chapterIndex }).from(sections).where(and(eq(sections.bookId, bookId), eq(sections.id, sectionId)));
  const prose = and(eq(sections.bookId, bookId), eq(sections.chapterIndex, at.chapterIndex), eq(sections.kind, "paragraph"), eq(sections.form, "prose"));
  const before = await db.select({ text: sections.text }).from(sections).where(and(prose, lt(sections.position, at.position))).orderBy(asc(sections.position));
  const after = await db.select({ text: sections.text }).from(sections).where(and(prose, gt(sections.position, at.position))).orderBy(asc(sections.position)).limit(AFTER);
  const cut = (rows: { text: string }[]) => rows.map((r) => r.text.slice(0, MAX_PARA)).join("\n\n");
  return { before: cut(before.slice(-BEFORE)), after: cut(after) };
}

async function buildRequest(db: Db, ownerId: string, bookId: string, eqn: Equation, style: Style): Promise<GenerationRequest> {
  const file = await readPrompt("explain-math");
  const instruction = await styleInstruction(style);
  const { system, user } = splitPrompt(file);
  const ctx = await around(db, bookId, eqn.id);
  return {
    ownerId,
    bookId,
    sectionId: eqn.id,
    kind: "explain-math",
    options: { style },
    promptName: `explain-math${instruction.promptSuffix}`,
    promptHash: sha256(`${file}\n\n${instruction.text}`),
    input: eqn.latex,
    system: fill(system, { style: instruction.text }),
    prompt: fill(user, { book: await bookLine(db, bookId), number: eqn.number ? ` (${eqn.number})` : "", latex: eqn.latex, before: ctx.before, after: ctx.after }),
    maxTokens: MAX_TOKENS,
    effort: "medium",
  };
}

export type MathView = Generation & { style: Style; ste: { score: number; errors: number; warnings: number } | null };

export function viewMath(g: Generation): MathView {
  const style = (g.options?.style as Style | undefined) ?? "plain";
  return { ...g, style, ste: steScore(style, [g.output]) };
}

/** Explains the equation (or re-serves the stored answer, unless `fresh`). */
export async function explainMath(
  db: Db,
  model: TextModel,
  ownerId: string,
  input: { bookId: string; cfi: string; latex: unknown; fresh?: boolean },
  opts: { caps?: Caps; now?: () => Date } = {},
) {
  const eqn = await equationAt(db, ownerId, input.bookId, input.cfi, input.latex);
  const { effective } = await getStyles(db, ownerId, input.bookId);
  const out = await generate(db, model, await buildRequest(db, ownerId, input.bookId, eqn, effective), { ...opts, fresh: input.fresh });
  return { ...out, equation: eqn, generation: viewMath(out.generation) };
}

export async function estimateExplainMath(db: Db, model: TextModel, ownerId: string, bookId: string, eqn: Equation) {
  const { effective } = await getStyles(db, ownerId, bookId);
  return estimateCost(model, await buildRequest(db, ownerId, bookId, eqn, effective));
}

/** Every stored explanation of this equation, oldest first (for this LaTeX: another would be another question). */
export const listExplainMath = async (db: Db, ownerId: string, bookId: string, eqn: Equation) =>
  (await listGenerations(db, ownerId, bookId, eqn.id, "explain-math")).filter((g) => g.provenance.inputHash === sha256(eqn.latex)).map(viewMath);
