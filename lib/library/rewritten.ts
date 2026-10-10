import type { Caps } from "@/lib/ai/generate";
import type { TextModel } from "@/lib/ai/model";
import type { Db } from "@/lib/db/client";
import { getStyles } from "./ai-style";
import { paragraphsBetween } from "./annotations";
import { rewriteFor, type Style } from "./levels";
import { estimateRewrite, listRewrites, rewriteParagraph, viewRewrite, type RewriteView } from "./rewrite";

/**
 * Read it rewritten (M17, docs/rewritten-view-plan.md): the paragraphs on
 * screen, each with its rewrite in the reader's style for this book (Aa, AI
 * explanations), or what a rewrite would cost. The rewrites are the Rewrite
 * panel's stored versions (M6): one made there at the same level and
 * strictness shows here too, and is not paid for again.
 */
export type Piece = {
  id: string;
  /** Where it is: the paragraph's CFI (EPUB), or its page's (PDF). */
  cfi: string;
  text: string;
  /** The newest rewrite in the style, or null. */
  rewrite: RewriteView | null;
  /** Without a rewrite: its rough cost in US dollars (null when Claude is not set up). */
  estimate: number | null;
};

/** Whether a stored rewrite is in a style: Plain English, or STE at the style's strictness. */
export function inStyle(g: { options: Record<string, string> }, style: Style) {
  const want = rewriteFor(style);
  if (g.options.level !== want.level) return false;
  // Rewrites made before the strictness dial were Standard.
  return want.level !== "ste" || (g.options.strictness ?? "standard") === want.strictness;
}

/** The paragraphs from `from` to `to` (CFIs) with their rewrites in the book's style. */
export async function rewrittenView(db: Db, model: TextModel | null, ownerId: string, bookId: string, at: { from: string; to: string }) {
  const { effective: style } = await getStyles(db, ownerId, bookId);
  const want = rewriteFor(style);
  const strictness = want.level === "ste" ? want.strictness : undefined;
  const pieces: Piece[] = [];
  for (const p of await paragraphsBetween(db, bookId, at.from, at.to)) {
    const rewrite = (await listRewrites(db, ownerId, bookId, p.id)).filter((g) => inStyle(g, style)).at(-1) ?? null;
    const estimate = !rewrite && model ? await estimateRewrite(db, model, ownerId, bookId, p.id, want.level, strictness) : null;
    pieces.push({ id: p.id, cfi: p.cfi, text: p.text, rewrite, estimate });
  }
  return { style, pieces };
}

/** Rewrites one paragraph in the book's style, or re-serves the stored rewrite. `fresh` asks again. */
export async function rewriteInStyle(
  db: Db,
  model: TextModel,
  ownerId: string,
  input: { bookId: string; sectionId: string; fresh?: boolean },
  opts: { caps?: Caps; now?: () => Date } = {},
) {
  const { effective: style } = await getStyles(db, ownerId, input.bookId);
  const out = await rewriteParagraph(db, model, ownerId, { ...input, ...rewriteFor(style) }, opts);
  return { style, reused: out.reused, generation: viewRewrite(out.generation) };
}
