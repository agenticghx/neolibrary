import { and, asc, desc, eq } from "drizzle-orm";
import { estimateCost, findStored, generate, toGeneration, type Caps, type Generation, type GenerationRequest } from "@/lib/ai/generate";
import type { TextModel } from "@/lib/ai/model";
import { fill, readPrompt, sha256, splitPrompt } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { generations, sections } from "@/lib/db/schema";
import { getStyles } from "./ai-style";
import { createAnnotation, type Annotation } from "./annotations";
import { cut, passagesBlock, type Passage } from "./ask";
import type { Style } from "./levels";
import { bookLine, chapterFor, styleInstruction, type Chapter } from "./prerequisites";

/**
 * Explain it back (M26 R1): at the end of a part of a book (an EPUB chapter, a PDF page), the reader writes about
 * three sentences on what it argued. Their summary is saved first, as their own note on the part. Then Claude
 * compares it with the part's paragraphs (`prompts/explain-back.md`) and points to the lines the summary missed or
 * got wrong, each quoted from the book and linked to its place.
 *
 * The reader writes first, Claude responds second: an answer exists only as a reply to a summary.
 *
 * Stored like every AI answer (ground rule 5): the same summary of the same part is answered once, and asking again
 * re-serves it at no cost (and adds no second note). The spending caps apply. If the call fails (a cap, no AI set
 * up), the summary is still saved: nothing the reader wrote is lost.
 *
 * A quote is shown as a quote only when it is found, word for word, in the passage it names (or, failing that, in
 * another passage of the part). Otherwise the reader sees the start of the passage instead, marked as such: a quote
 * Claude made up is never presented as the book's words.
 */
export class ExplainBackError extends Error {}

export const MIN_WORDS = 8;
export const MAX_SUMMARY_CHARS = 2000;
export const MAX_ITEMS = 5;
// About 15,000 tokens of the part, as for Need to know and Test yourself: a known ceiling on the cost.
const MAX_CHARS = 60_000;
const MAX_PARAGRAPH_CHARS = 4000;
const MAX_TOKENS = 4000;
const EXCERPT_CHARS = 180;
const ANCHOR_CHARS = 300;

export const KINDS = { missed: "Missed", misread: "Not quite" } as const;
export type ItemKind = keyof typeof KINDS;

export const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: Object.keys(KINDS) },
          passage: { type: "integer", description: "The number of the passage that shows it." },
          quote: { type: "string", description: "One sentence, or part of one, copied exactly from that passage." },
          why: { type: "string", description: "One short sentence to the reader." },
        },
        required: ["kind", "passage", "quote", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/** The summary, tidied: trimmed, at most 2,000 characters, with at least a sentence's worth of words. */
export function cleanSummary(summary: unknown) {
  if (typeof summary !== "string") throw new ExplainBackError("Write what this part argued, in your own words.");
  const s = summary
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_SUMMARY_CHARS);
  const words = s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (words < MIN_WORDS) throw new ExplainBackError(`Write at least ${MIN_WORDS} words: about three sentences on what this part argued.`);
  return s;
}

/** The part's paragraphs, numbered in reading order, each cut to a limit, until the part's limit is reached. */
export async function partPassages(db: Db, bookId: string, chapter: Chapter): Promise<Passage[]> {
  const rows = await db
    .select({ id: sections.id, cfi: sections.cfi, text: sections.text })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.chapterIndex, chapter.chapterIndex), eq(sections.kind, "paragraph")))
    .orderBy(asc(sections.position));
  const out: Passage[] = [];
  let total = 0;
  for (const r of rows) {
    const text = r.text.trim();
    if (!text) continue;
    const kept = cut(text, MAX_PARAGRAPH_CHARS);
    if (out.length && total + kept.length > MAX_CHARS) break;
    total += kept.length;
    out.push({ n: out.length + 1, sectionId: r.id, cfi: r.cfi, chapter: "", text: kept });
  }
  if (!out.length) throw new ExplainBackError("This part has no text to compare with.");
  return out;
}

/** The request to the model. The summary and the passages are the input; the summary is also an option, so it can be shown again. */
export async function buildRequest(
  db: Db,
  ownerId: string,
  bookId: string,
  chapter: Chapter,
  style: Style,
  summary: string,
  passages: Passage[],
): Promise<GenerationRequest> {
  const file = await readPrompt("explain-back");
  const instruction = await styleInstruction(style);
  const { system, user } = splitPrompt(file);
  const block = passagesBlock(passages);
  const safe = summary.replace(/[<>]/g, " ");
  return {
    ownerId,
    bookId,
    sectionId: chapter.id,
    kind: "explain-back",
    options: { style, summary },
    promptName: `explain-back${instruction.promptSuffix}`,
    promptHash: sha256(`${file}\n\n${instruction.text}`),
    input: `Summary: ${summary}\n\n${block}`,
    system: fill(system, { style: instruction.text }),
    prompt: fill(user, { book: await bookLine(db, bookId), chapter: chapter.label, summary: safe, passages: block }),
    maxTokens: MAX_TOKENS,
    effort: "medium",
    schema: SCHEMA,
  };
}

/** For comparing a quote with the book: one kind of quotation mark and apostrophe, one space, no case. */
export const normalize = (s: string) =>
  s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export type Item = {
  kind: ItemKind;
  /** The passage it points to: its number, and where it is in the book. */
  n: number;
  cfi: string;
  /** The quote, when found word for word in the book; else null, and `excerpt` is the start of the passage. */
  quote: string | null;
  excerpt: string;
  why: string;
};

/**
 * The model's items, checked against the passages: a passage number that does not exist is dropped; a quote not
 * found in the book is not shown as a quote.
 */
export function checkItems(output: string, passages: Passage[]): Item[] {
  let raw: { kind?: unknown; passage?: unknown; quote?: unknown; why?: unknown }[] = [];
  try {
    raw = (JSON.parse(output) as { items?: typeof raw }).items ?? [];
  } catch {
    return [];
  }
  const items: Item[] = [];
  for (const r of raw) {
    if (items.length === MAX_ITEMS) break;
    const named = passages.find((p) => p.n === Number(r.passage));
    const quote = typeof r.quote === "string" ? r.quote.trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim() : "";
    const why = typeof r.why === "string" ? r.why.trim() : "";
    if (!why) continue;
    // Where the quote really is: the passage named, or another one of this part.
    const found = quote.length >= 8 ? [named, ...passages].find((p) => p && normalize(p.text).includes(normalize(quote))) : undefined;
    const at = found ?? named;
    if (!at) continue;
    items.push({
      kind: (Object.hasOwn(KINDS, String(r.kind)) ? r.kind : "missed") as ItemKind,
      n: at.n,
      cfi: at.cfi,
      quote: found ? quote : null,
      excerpt: cut(at.text, EXCERPT_CHARS),
      why,
    });
  }
  return items;
}

export type Attempt = {
  id: string;
  summary: string;
  items: Item[];
  style: Style;
  provenance: Generation["provenance"];
};

async function passagesFor(db: Db, bookId: string, chapter: Chapter) {
  try {
    return await partPassages(db, bookId, chapter);
  } catch {
    return [];
  }
}

export function viewAttempt(g: Generation, passages: Passage[]): Attempt {
  return {
    id: g.id,
    summary: g.options.summary ?? "",
    items: checkItems(g.output, passages),
    style: (g.options.style as Style | undefined) ?? "plain",
    provenance: g.provenance,
  };
}

/** Where the summary note is anchored: the part's first paragraph, quoted (so it is a Daily review card too). */
function anchor(passages: Passage[]) {
  const first = passages[0];
  return { cfi: first.cfi, quote: { exact: first.text.slice(0, ANCHOR_CHARS), prefix: "", suffix: "" } };
}

export type ExplainResult = {
  /** The note made from the summary, or null when this summary was already answered (no second note). */
  note: Annotation | null;
  attempt: Attempt | null;
  reused: boolean;
  /** Why there is no answer, when the call could not be made: the summary is saved all the same. */
  error: unknown;
};

/**
 * Saves the reader's summary of a part as a note, then asks Claude what it missed. The same summary of the same
 * part, asked again, is re-served from storage: no call, no second note.
 */
export async function explainBack(
  db: Db,
  /** The model, or how to get it: asked for only after the note is saved, so a missing AI set-up loses nothing. */
  model: TextModel | (() => TextModel),
  ownerId: string,
  input: { bookId: string; chapterId: unknown; summary: unknown },
  opts: { caps?: Caps; now?: () => Date } = {},
): Promise<ExplainResult> {
  if (typeof input.chapterId !== "string" || !input.chapterId) throw new ExplainBackError("Open a part of the book first.");
  const summary = cleanSummary(input.summary);
  const chapter = await chapterFor(db, ownerId, input.bookId, { chapterId: input.chapterId });
  const passages = await partPassages(db, input.bookId, chapter);
  const { effective } = await getStyles(db, ownerId, input.bookId);
  const req = await buildRequest(db, ownerId, input.bookId, chapter, effective, summary, passages);
  const stored = await findStored(db, ownerId, req);
  if (stored) return { note: null, attempt: viewAttempt(stored, passages), reused: true, error: null };
  // The reader's words are kept before anything is asked of Claude.
  const where = anchor(passages);
  const note = await createAnnotation(db, ownerId, { kind: "note", bookId: input.bookId, cfi: where.cfi, quote: where.quote, body: summary }, opts.now?.());
  try {
    const out = await generate(db, typeof model === "function" ? model() : model, req, opts);
    return { note, attempt: viewAttempt(out.generation, passages), reused: out.reused, error: null };
  } catch (e) {
    return { note, attempt: null, reused: false, error: e };
  }
}

/** The most checking a summary of this part costs: a summary at its longest. */
export async function estimateExplainBack(db: Db, model: TextModel, ownerId: string, bookId: string, chapter: Chapter) {
  const passages = await partPassages(db, bookId, chapter);
  const { effective } = await getStyles(db, ownerId, bookId);
  return estimateCost(model, await buildRequest(db, ownerId, bookId, chapter, effective, "x".repeat(MAX_SUMMARY_CHARS), passages));
}

/** The reader's earlier attempts on this part, newest first, each with what Claude found. */
export async function listAttempts(db: Db, ownerId: string, bookId: string, chapter: Chapter): Promise<Attempt[]> {
  const rows = await db
    .select()
    .from(generations)
    .where(
      and(eq(generations.ownerId, ownerId), eq(generations.bookId, bookId), eq(generations.sectionId, chapter.id), eq(generations.kind, "explain-back")),
    )
    .orderBy(desc(generations.createdAt), desc(generations.id));
  if (!rows.length) return [];
  const passages = await passagesFor(db, bookId, chapter);
  return rows.map((r) => viewAttempt(toGeneration(r), passages));
}

/** Where a spoken summary is saved (the voice note): the same anchor as a written one. */
export async function partAnchor(db: Db, bookId: string, chapter: Chapter) {
  return anchor(await partPassages(db, bookId, chapter));
}
