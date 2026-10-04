import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { estimateCost, generate, listGenerations, toGeneration, type Caps, type Generation, type GenerationRequest } from "@/lib/ai/generate";
import type { TextModel } from "@/lib/ai/model";
import { fill, readPrompt, sha256, splitPrompt } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { generations, questionMarks, sections } from "@/lib/db/schema";
import { getStyles } from "./ai-style";
import type { Style } from "./levels";
import { bookLine, chapterFor, chapterText, steScore, styleInstruction, type Chapter } from "./prerequisites";

/**
 * Question bank per chapter (M6): recall, understanding and application
 * questions with model answers, stored once per chapter and style (ground
 * rule 5). The reader marks each one right or wrong; marks are append-only
 * (ground rule 9) and the latest counts. Chapters with wrong answers are the
 * ones that need a re-read.
 */
export class QuestionsError extends Error {}

export const TYPES = { recall: "Recall", understanding: "Understanding", application: "Application" } as const;
export type QuestionType = keyof typeof TYPES;

const MAX_TOKENS = 8000;
const MAX_QUESTIONS = 15;

export const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: Object.keys(TYPES) },
          question: { type: "string" },
          answer: { type: "string", description: "A short model answer, one to three sentences." },
        },
        required: ["type", "question", "answer"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

async function buildRequest(db: Db, ownerId: string, bookId: string, chapter: Chapter, style: Style): Promise<GenerationRequest> {
  const text = await chapterText(db, bookId, chapter);
  const file = await readPrompt("questions");
  const instruction = await styleInstruction(style);
  const { system, user } = splitPrompt(file);
  return {
    ownerId,
    bookId,
    sectionId: chapter.id,
    kind: "questions",
    options: { style },
    promptName: `questions${instruction.promptSuffix}`,
    promptHash: sha256(`${file}\n\n${instruction.text}`),
    input: text,
    system: fill(system, { style: instruction.text }),
    prompt: fill(user, { book: await bookLine(db, bookId), chapter: chapter.label, text }),
    maxTokens: MAX_TOKENS,
    effort: "medium",
    schema: SCHEMA,
  };
}

export type Question = { index: number; type: QuestionType; question: string; answer: string };
export type QuestionsView = Generation & {
  style: Style;
  questions: Question[];
  ste: { score: number; errors: number; warnings: number } | null;
};

export function viewQuestions(g: Generation): QuestionsView {
  let questions: Question[] = [];
  try {
    const data = JSON.parse(g.output) as { questions?: { type?: unknown; question?: unknown; answer?: unknown }[] };
    questions = (data.questions ?? [])
      .slice(0, MAX_QUESTIONS)
      .map((q, index) => ({ index, q }))
      .filter(({ q }) => typeof q?.question === "string" && q.question.trim() && typeof q.answer === "string")
      .map(({ index, q }) => ({
        index,
        type: (Object.hasOwn(TYPES, String(q.type)) ? q.type : "recall") as QuestionType,
        question: String(q.question).trim(),
        answer: String(q.answer).trim(),
      }));
  } catch {
    // Not JSON (should not happen with structured output): show nothing rather than garbage.
  }
  const style = (g.options?.style as Style | undefined) ?? "plain";
  return { ...g, style, questions, ste: steScore(style, questions.flatMap((q) => [q.question, q.answer])) };
}

export async function questionBank(
  db: Db,
  model: TextModel,
  ownerId: string,
  input: { bookId: string; chapterId: string; fresh?: boolean },
  opts: { caps?: Caps; now?: () => Date } = {},
) {
  const chapter = await chapterFor(db, ownerId, input.bookId, { chapterId: input.chapterId });
  const { effective } = await getStyles(db, ownerId, input.bookId);
  const out = await generate(db, model, await buildRequest(db, ownerId, input.bookId, chapter, effective), { ...opts, fresh: input.fresh });
  return { ...out, generation: viewQuestions(out.generation) };
}

export async function estimateQuestionBank(db: Db, model: TextModel, ownerId: string, bookId: string, chapter: Chapter) {
  const { effective } = await getStyles(db, ownerId, bookId);
  return estimateCost(model, await buildRequest(db, ownerId, bookId, chapter, effective));
}

export const listQuestionBanks = async (db: Db, ownerId: string, bookId: string, chapterId: string) =>
  (await listGenerations(db, ownerId, bookId, chapterId, "questions")).map(viewQuestions);

/** Marks one question right or wrong. Adds a row; earlier marks stay. */
export async function markQuestion(db: Db, ownerId: string, input: { generationId: unknown; index: unknown; correct: unknown }) {
  if (typeof input.generationId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.generationId)) throw new QuestionsError("Question not found.");
  if (typeof input.correct !== "boolean") throw new QuestionsError("Mark it right or wrong.");
  const [g] = await db
    .select()
    .from(generations)
    .where(and(eq(generations.id, input.generationId), eq(generations.ownerId, ownerId), eq(generations.kind, "questions")));
  const question = g ? viewQuestions(toGeneration(g)).questions.find((q) => q.index === input.index) : undefined;
  if (!g || !g.bookId || !g.sectionId || !question) throw new QuestionsError("Question not found.");
  await db.insert(questionMarks).values({
    ownerId,
    bookId: g.bookId,
    chapterId: g.sectionId,
    generationId: g.id,
    questionIndex: question.index,
    correct: input.correct,
  });
  return marksFor(db, ownerId, g.bookId);
}

/** The latest mark of every marked question in a book: "<generationId>:<index>" → right (true) or wrong. */
export async function marksFor(db: Db, ownerId: string, bookId: string) {
  const rows = await db
    .select()
    .from(questionMarks)
    .where(and(eq(questionMarks.ownerId, ownerId), eq(questionMarks.bookId, bookId)))
    .orderBy(asc(questionMarks.createdAt), asc(questionMarks.id));
  const out: Record<string, boolean> = {};
  for (const r of rows) out[`${r.generationId}:${r.questionIndex}`] = r.correct;
  return out;
}

/** Chapters to re-read: those with a question whose latest mark is wrong (in any of their question banks). In reading order. */
export async function needsReread(db: Db, ownerId: string, bookId: string) {
  const marks = await marksFor(db, ownerId, bookId);
  const banks = await db
    .select({ id: generations.id, sectionId: generations.sectionId, createdAt: generations.createdAt })
    .from(generations)
    .where(and(eq(generations.ownerId, ownerId), eq(generations.bookId, bookId), eq(generations.kind, "questions")))
    .orderBy(desc(generations.createdAt));
  const tally = new Map<string, { wrong: number; marked: number }>();
  for (const [key, correct] of Object.entries(marks)) {
    const bank = banks.find((b) => b.id === key.split(":")[0]);
    if (!bank?.sectionId) continue;
    const t = tally.get(bank.sectionId) ?? { wrong: 0, marked: 0 };
    t.marked += 1;
    if (!correct) t.wrong += 1;
    tally.set(bank.sectionId, t);
  }
  const ids = [...tally].filter(([, t]) => t.wrong > 0).map(([id]) => id);
  if (!ids.length) return [];
  const chapters = await db
    .select({ id: sections.id, label: sections.label, chapterIndex: sections.chapterIndex })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), inArray(sections.id, ids)))
    .orderBy(asc(sections.position));
  // Link to the chapter's first paragraph: the reader opens at a place in the text, not at a whole chapter.
  const firsts = await db
    .select({ chapterIndex: sections.chapterIndex, cfi: sections.cfi })
    .from(sections)
    .where(
      and(
        eq(sections.bookId, bookId),
        eq(sections.kind, "paragraph"),
        inArray(
          sections.chapterIndex,
          chapters.map((c) => c.chapterIndex),
        ),
      ),
    )
    .orderBy(asc(sections.position));
  return chapters.map(({ chapterIndex, ...c }) => ({
    ...c,
    cfi: firsts.find((f) => f.chapterIndex === chapterIndex)?.cfi ?? "",
    ...tally.get(c.id)!,
  }));
}
