import { and, asc, desc, eq, gt } from "drizzle-orm";
import { capsFromEnv, checkCaps, type Caps } from "@/lib/ai/generate";
import { sha256 } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { audioTracks, books, sections } from "@/lib/db/schema";
import { speechCost, type SpeechModel } from "@/lib/speech/model";
import { wordTimings, type WordTiming } from "@/lib/speech/timings";
import type { Storage } from "@/lib/storage";
import { sectionForCfi } from "./annotations";

/**
 * Reading aloud (M7). Audio is made one paragraph at a time when first
 * played, stored, and re-served after (ground rule 5): the same paragraph,
 * voice and model is never paid for twice. Each track keeps word timings so
 * the reader can highlight the word being spoken. ElevenLabs bills per
 * character, so a cost estimate comes first and the voice caps
 * (VOICE_CAP_PER_BOOK_USD, VOICE_CAP_PER_MONTH_USD) stop it (ground rule 8).
 */
export class AudioError extends Error {}

export type Track = {
  id: string;
  sectionId: string;
  voice: string;
  source: "tts" | "upload";
  provider: string | null;
  model: string | null;
  audioKey: string;
  mime: string;
  durationMs: number;
  words: WordTiming[];
  characters: number;
  costUsd: number;
  createdAt: string;
};

type Row = typeof audioTracks.$inferSelect;

const toTrack = (r: Row): Track => ({
  id: r.id,
  sectionId: r.sectionId,
  voice: r.voice,
  source: r.source,
  provider: r.provider,
  model: r.model,
  audioKey: r.audioKey,
  mime: r.mime,
  durationMs: r.durationMs,
  words: r.words,
  characters: r.characters,
  costUsd: r.costUsd,
  createdAt: r.createdAt.toISOString(),
});

export type Passage = { id: string; text: string; cfi: string; chapterIndex: number; nextId: string | null; previousText: string; nextText: string };

/** The paragraph at a place in the book (a CFI) or with an id, and the one after it (to read on). */
export async function passageFor(db: Db, ownerId: string, bookId: string, at: { cfi: string } | { sectionId: string }): Promise<Passage> {
  const [book] = await db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book) throw new AudioError("Book not found");
  let id = "cfi" in at ? await sectionForCfi(db, bookId, at.cfi) : at.sectionId;
  let [row] = id
    ? await db
        .select({ id: sections.id, kind: sections.kind, text: sections.text, cfi: sections.cfi, chapterIndex: sections.chapterIndex, position: sections.position })
        .from(sections)
        .where(and(eq(sections.bookId, bookId), eq(sections.id, id)))
    : [];
  // From a heading, or the top of a chapter, read on from the next paragraph.
  if (!row && "cfi" in at) {
    const spine = /^epubcfi\(\/6\/(\d+)/.exec(at.cfi)?.[1];
    if (spine) {
      [row] = await db
        .select({ id: sections.id, kind: sections.kind, text: sections.text, cfi: sections.cfi, chapterIndex: sections.chapterIndex, position: sections.position })
        .from(sections)
        .where(and(eq(sections.bookId, bookId), eq(sections.chapterIndex, Number(spine) / 2 - 1), eq(sections.kind, "paragraph")))
        .orderBy(asc(sections.position))
        .limit(1);
    }
  }
  if (row && row.kind !== "paragraph") {
    [row] = await db
      .select({ id: sections.id, kind: sections.kind, text: sections.text, cfi: sections.cfi, chapterIndex: sections.chapterIndex, position: sections.position })
      .from(sections)
      .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph"), gt(sections.position, row.position)))
      .orderBy(asc(sections.position))
      .limit(1);
  }
  if (!row) throw new AudioError("There is nothing to read aloud here.");
  id = row.id;
  const around = await db
    .select({ id: sections.id, text: sections.text, position: sections.position })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph")))
    .orderBy(asc(sections.position));
  const i = around.findIndex((s) => s.id === id);
  return {
    id: row.id,
    text: row.text,
    cfi: row.cfi,
    chapterIndex: row.chapterIndex,
    nextId: around[i + 1]?.id ?? null,
    previousText: around[i - 1]?.text.slice(-300) ?? "",
    nextText: around[i + 1]?.text.slice(0, 300) ?? "",
  };
}

const cacheKeyOf = (model: SpeechModel, voice: string, text: string) => sha256(JSON.stringify([model.provider, model.model, voice, sha256(text)]));

export async function storedTrack(db: Db, ownerId: string, model: SpeechModel, voice: string, passage: Passage) {
  const [row] = await db
    .select()
    .from(audioTracks)
    .where(and(eq(audioTracks.ownerId, ownerId), eq(audioTracks.cacheKey, cacheKeyOf(model, voice, passage.text))))
    .orderBy(desc(audioTracks.createdAt))
    .limit(1);
  return row ? toTrack(row) : null;
}

/** The rough cost of reading a paragraph aloud, in US dollars. */
export const estimateSpeech = (passage: Pick<Passage, "text">) => speechCost(passage.text.length);

const EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav" };

// Two identical requests at the same moment share one call.
const inflight = new Map<string, Promise<{ track: Track; reused: boolean }>>();

/** Reads a paragraph aloud, or re-serves the stored track. */
export async function speakPassage(
  db: Db,
  storage: Storage,
  model: SpeechModel,
  ownerId: string,
  input: { bookId: string; sectionId: string; voice: string },
  opts: { caps?: Caps; now?: () => Date } = {},
): Promise<{ track: Track; reused: boolean }> {
  const key = `${ownerId}|${input.bookId}|${input.sectionId}|${input.voice}|${model.model}`;
  const running = inflight.get(key);
  if (running) return { track: (await running).track, reused: true };
  const job = speak(db, storage, model, ownerId, input, opts);
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

async function speak(
  db: Db,
  storage: Storage,
  model: SpeechModel,
  ownerId: string,
  input: { bookId: string; sectionId: string; voice: string },
  opts: { caps?: Caps; now?: () => Date } = {},
): Promise<{ track: Track; reused: boolean }> {
  const passage = await passageFor(db, ownerId, input.bookId, { sectionId: input.sectionId });
  if (!(await model.voices()).some((v) => v.id === input.voice)) throw new AudioError("Choose one of the voices on offer.");
  const stored = await storedTrack(db, ownerId, model, input.voice, passage);
  if (stored) return { track: stored, reused: true };
  const now = opts.now?.() ?? new Date();
  await checkCaps(db, model.provider, input.bookId, estimateSpeech(passage), opts.caps ?? capsFromEnv(process.env, "VOICE"), now, "voice");
  const result = await model.speak({ text: passage.text, voiceId: input.voice, previousText: passage.previousText, nextText: passage.nextText });
  const words = wordTimings(passage.text, result.alignment);
  const id = crypto.randomUUID();
  const audioKey = `audio/${ownerId}/${input.bookId}/${id}.${EXT[result.mime] ?? "bin"}`;
  await storage.put(audioKey, result.audio, result.mime);
  const [row] = await db
    .insert(audioTracks)
    .values({
      id,
      ownerId,
      bookId: input.bookId,
      sectionId: passage.id,
      source: "tts",
      provider: model.provider,
      model: model.model,
      voice: input.voice,
      cacheKey: cacheKeyOf(model, input.voice, passage.text),
      inputHash: sha256(passage.text),
      characters: result.characters,
      costUsd: speechCost(result.characters),
      audioKey,
      mime: result.mime,
      durationMs: Math.round(Math.max(...result.alignment.ends, 0) * 1000),
      words,
      createdAt: now,
    })
    .returning();
  return { track: toTrack(row), reused: false };
}

/** Every track of a book, oldest first (for the export). */
export async function listTracks(db: Db, ownerId: string, bookId: string) {
  return (
    await db
      .select()
      .from(audioTracks)
      .where(and(eq(audioTracks.ownerId, ownerId), eq(audioTracks.bookId, bookId)))
      .orderBy(asc(audioTracks.createdAt))
  ).map(toTrack);
}
