import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { estimateCost, generate, toGeneration, type Caps, type Generation, type GenerationRequest } from "@/lib/ai/generate";
import type { TextModel } from "@/lib/ai/model";
import { fill, readPrompt, sha256, splitPrompt } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { books, generations } from "@/lib/db/schema";
import { bookLine } from "./prerequisites";

/**
 * Ask this book (M21): a question answered only from the book's own
 * paragraphs, with citations.
 *
 * 1. Retrieval, inside Postgres: the question's meaningful words (stop words
 *    dropped) are joined with OR and matched against the paragraphs' full-text
 *    index (sections.search) for this one book; the best-ranked few are kept.
 *    Find in this book joins words with AND, which is too strict for a
 *    question: few paragraphs contain every word of one.
 * 2. Answer: the question and the numbered passages go to Claude
 *    (`prompts/ask.md`), which may use only those passages and cites them as
 *    [1], [2]. Stored like every AI answer (ground rule 5): asking the same
 *    question again re-serves it at no cost, and the spending caps apply.
 * 3. The citations are parsed here: a number that is not one of the passages
 *    is never turned into a link.
 */
export class AskError extends Error {}
export class AskNotFound extends AskError {}

/** At most this many paragraphs go to the model, each cut to MAX_PASSAGE_CHARS: a known ceiling on the cost. */
export const MAX_PASSAGES = 8;
export const MAX_PASSAGE_CHARS = 1500;
export const MAX_QUESTION_CHARS = 300;
const MAX_TERMS = 12;
const EXCERPT_CHARS = 160;
// The answer is short, but Claude may think first; this leaves room so it is not cut off.
const MAX_TOKENS = 2000;

/**
 * Words that say nothing about where an answer is: English function words, and the scaffolding of a question
 * ("what does the author say about…"). Postgres drops its own stop words too; this list goes further.
 */
const STOP_WORDS = new Set(
  (
    "a about above after again against all also am an and any are aren as at be because been before being below between both but by " +
    "can cannot could couldn did didn do does doesn doing don down during each few for from further had hadn has hasn have haven having " +
    "he her here hers herself him himself his how i if in into is isn it its itself just let me more most my myself no nor not now of " +
    "off on once only or other ought our ours ourselves out over own same shan she should shouldn so some such than that the their " +
    "theirs them themselves then there these they this those through to too under until up upon very was wasn we were weren what when " +
    "where which while who whom whose why will with won would wouldn you your yours yourself yourselves " +
    // The question's own scaffolding.
    "according author book chapter describe described describes explain explained explains mean meaning means meant passage say " +
    "says tell tells text"
  ).split(" "),
);

/** The question's meaningful words, lower-cased, without stop words or repeats, in the order asked (at most 12). */
export function questionTerms(question: string): string[] {
  const out: string[] = [];
  for (const w of question.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 2 || STOP_WORDS.has(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length === MAX_TERMS) break;
  }
  return out;
}

/**
 * The text-search query for those words, joined with OR, for Postgres' `websearch_to_tsquery`: it understands
 * the word "or", stems each word as the stored index was stemmed, and never fails on odd input.
 */
export const orQuery = (terms: string[]) => terms.join(" or ");

/** The question, tidied: one line, trimmed, at most 300 characters. */
export function cleanQuestion(question: unknown) {
  if (typeof question !== "string") throw new AskError("Type a question.");
  const q = question.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_CHARS);
  if (!q) throw new AskError("Type a question.");
  return q;
}

/** Cuts text at a word boundary, with an ellipsis, when it is longer than `max`. */
export function cut(text: string, max: number) {
  if (text.length <= max) return text;
  const at = text.lastIndexOf(" ", max - 1);
  return `${text.slice(0, at > max / 2 ? at : max - 1).replace(/[\s,;:.]+$/, "")}…`;
}

export type Passage = { n: number; sectionId: string; cfi: string; chapter: string; text: string };
/** What the reader sees of a passage: its number, where it is, and a short excerpt. */
export type PassageView = Omit<Passage, "text"> & { excerpt: string };

type Row = { sectionId: string; cfi: string; chapter: string; text: string; position: number };
const rowsOf = (r: unknown) => (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as Row[];

/** Numbers paragraphs 1, 2, 3… in reading order, each cut to the passage limit. */
const numbered = (rows: Row[]): Passage[] =>
  [...rows]
    .sort((a, b) => a.position - b.position)
    .map((r, i) => ({ n: i + 1, sectionId: r.sectionId, cfi: r.cfi, chapter: r.chapter, text: cut(r.text, MAX_PASSAGE_CHARS) }));

/**
 * The paragraphs of one of the reader's books that best match the question's words (any of them, best ranked
 * first), numbered in reading order. Empty when no word of the question is in the book.
 */
export async function findPassages(db: Db, ownerId: string, bookId: string, question: string, limit = MAX_PASSAGES): Promise<Passage[]> {
  const terms = questionTerms(question);
  if (!terms.length) return [];
  const rows = await db.execute(sql`
    WITH query AS (SELECT websearch_to_tsquery('english', ${orQuery(terms)}) AS q)
    SELECT s.id AS "sectionId", s.cfi, s.text, s.position, coalesce(ch.label, '') AS chapter
    FROM sections s
    JOIN books b ON b.id = s.book_id
    JOIN query ON s.search @@ query.q
    LEFT JOIN sections ch ON ch.book_id = s.book_id AND ch.kind = 'chapter' AND ch.chapter_index = s.chapter_index
    WHERE b.id = ${bookId} AND b.owner_id = ${ownerId} AND b.deleted_at IS NULL
      AND s.kind = 'paragraph' AND s.text <> ''
    ORDER BY ts_rank(s.search, query.q) DESC, s.position
    LIMIT ${limit}
  `);
  return numbered(rowsOf(rows));
}

/** The passages of an earlier answer, by their paragraph ids, numbered as they were then. */
async function passagesByIds(db: Db, bookId: string, ids: string[]): Promise<Passage[]> {
  if (!ids.length) return [];
  const rows = rowsOf(
    await db.execute(sql`
      SELECT s.id AS "sectionId", s.cfi, s.text, s.position, coalesce(ch.label, '') AS chapter
      FROM sections s
      LEFT JOIN sections ch ON ch.book_id = s.book_id AND ch.kind = 'chapter' AND ch.chapter_index = s.chapter_index
      WHERE s.book_id = ${bookId} AND s.id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
    `),
  );
  // Kept in the stored order: [1] then means what it meant when it was answered.
  return ids.flatMap((id, i) => {
    const r = rows.find((x) => x.sectionId === id);
    return r ? [{ n: i + 1, sectionId: r.sectionId, cfi: r.cfi, chapter: r.chapter, text: cut(r.text, MAX_PASSAGE_CHARS) }] : [];
  });
}

const attr = (s: string) => s.replace(/[<>"&]/g, " ").trim();

/** The passages as the model sees them: each in its own numbered tag, with its chapter. */
export function passagesBlock(passages: Pick<Passage, "n" | "chapter" | "text">[]) {
  return passages.map((p) => `<passage n="${p.n}"${p.chapter ? ` chapter="${attr(p.chapter)}"` : ""}>\n${p.text}\n</passage>`).join("\n\n");
}

/** The request to the model. The question and the passages together are the input, so either changing asks anew. */
export async function buildAskRequest(
  ownerId: string,
  bookId: string,
  book: string,
  question: string,
  passages: Passage[],
): Promise<GenerationRequest> {
  const file = await readPrompt("ask");
  const { system, user } = splitPrompt(file);
  const block = passagesBlock(passages);
  return {
    ownerId,
    bookId,
    sectionId: null,
    kind: "ask",
    // The paragraph ids let a stored answer show its passages again; the question is what the reader asked.
    options: { question, passages: passages.map((p) => p.sectionId).join(" ") },
    promptName: "ask",
    promptHash: sha256(file),
    input: `Question: ${question}\n\n${block}`,
    system,
    prompt: fill(user, { book, question, passages: block }),
    maxTokens: MAX_TOKENS,
    effort: "low",
  };
}

/** A piece of an answer: plain text, or a citation of passage `cite`. */
export type Segment = { text: string } | { cite: number };

/**
 * Splits an answer into paragraphs of text and citations. "[1]", "[2][4]" and "[1, 3]" become citations of
 * passages that exist (the numbers in `valid`); any other number stays as plain text, so no link is ever invented.
 * `cited` lists the passages cited, in the order first cited.
 */
export function parseCitations(answer: string, valid: readonly number[]): { paragraphs: Segment[][]; cited: number[] } {
  const cited: number[] = [];
  const paragraphs = answer
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((para) => {
      const out: Segment[] = [];
      const push = (text: string) => {
        if (!text) return;
        const last = out.at(-1);
        if (last && "text" in last) last.text += text;
        else out.push({ text });
      };
      let at = 0;
      for (const m of para.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
        push(para.slice(at, m.index));
        for (const n of m[1].split(",").map((s) => Number(s.trim()))) {
          if (valid.includes(n)) {
            out.push({ cite: n });
            if (!cited.includes(n)) cited.push(n);
          } else push(`[${n}]`);
        }
        at = m.index + m[0].length;
      }
      push(para.slice(at));
      return out;
    });
  return { paragraphs, cited };
}

export type AskView = {
  id: string;
  question: string;
  /** The answer, in paragraphs of text and citations. */
  paragraphs: Segment[][];
  /** Every passage the model was given, numbered. */
  passages: PassageView[];
  /** The passage numbers the answer cites, in the order first cited. */
  cited: number[];
  provenance: Generation["provenance"];
};

export function viewAsk(g: Generation, passages: Passage[]): AskView {
  const { paragraphs, cited } = parseCitations(
    g.output,
    passages.map((p) => p.n),
  );
  return {
    id: g.id,
    question: g.options.question ?? "",
    paragraphs,
    passages: passages.map(({ text, ...p }) => ({ ...p, excerpt: cut(text, EXCERPT_CHARS) })),
    cited,
    provenance: g.provenance,
  };
}

/** Throws AskNotFound unless the book is the reader's own and still in the library. */
export async function assertOwnBook(db: Db, ownerId: string, bookId: string) {
  const [book] = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId), isNull(books.deletedAt)));
  if (!book) throw new AskNotFound("Book not found.");
}

export type AskResult = { found: false; terms: string[] } | { found: true; reused: boolean; answer: AskView };

/**
 * Answers a question from the book. When no paragraph has any of the question's words, nothing is sent to the
 * model and nothing is spent: the reader is told so instead.
 */
export async function askBook(
  db: Db,
  model: TextModel,
  ownerId: string,
  input: { bookId: string; question: unknown },
  opts: { caps?: Caps; now?: () => Date } = {},
): Promise<AskResult> {
  await assertOwnBook(db, ownerId, input.bookId);
  const question = cleanQuestion(input.question);
  const passages = await findPassages(db, ownerId, input.bookId, question);
  if (!passages.length) return { found: false, terms: questionTerms(question) };
  const req = await buildAskRequest(ownerId, input.bookId, await bookLine(db, input.bookId), question, passages);
  const out = await generate(db, model, req, opts);
  return { found: true, reused: out.reused, answer: viewAsk(out.generation, passages) };
}

/**
 * The most a question costs, shown on the Ask button before the question is known: the estimate for the
 * longest question with the most passages at their longest. Generous, like every estimate here.
 */
export async function estimateAsk(db: Db, model: TextModel, bookId: string) {
  const longest = Array.from({ length: MAX_PASSAGES }, (_, i) => ({ n: i + 1, chapter: "A chapter", text: "x".repeat(MAX_PASSAGE_CHARS) }));
  const file = await readPrompt("ask");
  const { system, user } = splitPrompt(file);
  const question = "x".repeat(MAX_QUESTION_CHARS);
  const block = passagesBlock(longest);
  const prompt = fill(user, { book: await bookLine(db, bookId), question, passages: block });
  return estimateCost(model, { system, prompt, input: `Question: ${question}\n\n${block}`, maxTokens: MAX_TOKENS });
}

/** The reader's latest answer from this book, with its passages, or null: shown again when Ask is reopened. */
export async function latestAsk(db: Db, ownerId: string, bookId: string): Promise<AskView | null> {
  const [row] = await db
    .select()
    .from(generations)
    .where(and(eq(generations.ownerId, ownerId), eq(generations.bookId, bookId), eq(generations.kind, "ask")))
    .orderBy(desc(generations.createdAt), desc(generations.id))
    .limit(1);
  if (!row) return null;
  const g = toGeneration(row);
  const ids = (g.options.passages ?? "").split(" ").filter(Boolean);
  return viewAsk(g, await passagesByIds(db, bookId, ids));
}
