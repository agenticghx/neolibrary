import { and, asc, desc, eq, gt, gte, inArray } from "drizzle-orm";
import { capsFromEnv, checkCaps, type Caps } from "@/lib/ai/generate";
import { sha256 } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { audioTracks, books, readalongImports, sections } from "@/lib/db/schema";
import { nonSpaceBefore } from "@/lib/reader/text-range";
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
  /** M13: an uploaded track is this stretch of a longer file (ms), and its word times are times in that file. */
  audioStartMs: number | null;
  audioEndMs: number | null;
  importId: string | null;
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
  audioStartMs: r.audioStartMs,
  audioEndMs: r.audioEndMs,
  importId: r.importId,
});

export type Passage = {
  id: string;
  text: string;
  cfi: string;
  chapterIndex: number;
  /** Its place in reading order (sections.position). */
  position: number;
  nextId: string | null;
  /** The paragraph before (M14 step 6b: back 15 s past the start of this one's audio goes there). */
  prevId: string | null;
  previousText: string;
  nextText: string;
};

/** The paragraph at a place in the book (a CFI) or with an id, and the one after it (to read on). */
export async function passageFor(db: Db, ownerId: string, bookId: string, at: { cfi: string } | { sectionId: string }): Promise<Passage> {
  const [book] = await db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)));
  if (!book) throw new AudioError("Book not found");
  // A CFI with no place inside its chapter (no "!") is the top of a chapter,
  // or a whole PDF page: every paragraph of a page has its page's CFI, so
  // matching it would give the page's last paragraph; read from the first.
  let id = "cfi" in at ? (at.cfi.includes("!") ? await sectionForCfi(db, bookId, at.cfi) : null) : at.sectionId;
  let [row] = id
    ? await db
        .select({ id: sections.id, kind: sections.kind, text: sections.text, cfi: sections.cfi, chapterIndex: sections.chapterIndex, position: sections.position })
        .from(sections)
        .where(and(eq(sections.bookId, bookId), eq(sections.id, id)))
    : [];
  // From a heading, or the top of a chapter (or page), read on from the next
  // paragraph: the chapter's first, or the next chapter's if it has none.
  if (!row && "cfi" in at) {
    const spine = /^epubcfi\(\/6\/(\d+)/.exec(at.cfi)?.[1];
    if (spine) {
      [row] = await db
        .select({ id: sections.id, kind: sections.kind, text: sections.text, cfi: sections.cfi, chapterIndex: sections.chapterIndex, position: sections.position })
        .from(sections)
        .where(and(eq(sections.bookId, bookId), gte(sections.chapterIndex, Number(spine) / 2 - 1), eq(sections.kind, "paragraph")))
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
    position: row.position,
    nextId: around[i + 1]?.id ?? null,
    prevId: around[i - 1]?.id ?? null,
    previousText: around[i - 1]?.text.slice(-300) ?? "",
    nextText: around[i + 1]?.text.slice(0, 300) ?? "",
  };
}

/**
 * How a made paragraph is found again: by its voice and its text, for its owner (any of their books).
 * Whole-book narration (lib/library/narration.ts) counts a paragraph as saved by this same key.
 */
export const cacheKeyOf = (model: Pick<SpeechModel, "provider" | "model">, voice: string, text: string) =>
  sha256(JSON.stringify([model.provider, model.model, voice, sha256(text)]));

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

/** One paragraph of an uploaded audiobook, as the player needs it (M13 (d)). */
export type ReadingParagraph = {
  sectionId: string;
  /** Where it is in the book: the paragraph's CFI (EPUB), or its page's (PDF). */
  cfi: string;
  /** Its chapter (EPUB spine index) or page (PDF, from 0). */
  chapterIndex: number;
  /** Its place in reading order (sections.position). */
  position: number;
  /** Its text (M14 step 6b: away from the page, the mini-player shows the sentence being read from it). */
  text: string;
  /** Which of the audiobook's files it is in (an index into `files`). */
  file: number;
  /** Its stretch of that file, in milliseconds from the file's start. */
  startMs: number;
  endMs: number;
  /** [startMs, endMs, from, to]: times in the file, offsets into the paragraph's text. */
  words: WordTiming[];
  /**
   * PDF books only (M13 (e)): where each word is on its page, counted in
   * non-space characters from the top of the page's text (end exclusive).
   * The page's text layer in the reader holds the same characters, spaced
   * differently, so the reader finds each word by this count.
   */
  inPage?: [number, number][];
};

/**
 * A part of an audiobook's paragraphs, where the next part starts (a
 * sections.position), if there is more, and the name of each chapter (or PDF
 * page, "Page 3") its paragraphs are in, by chapterIndex.
 */
export type ReadingPart = { paragraphs: ReadingParagraph[]; more: number | null; chapters: Record<number, string> };

/** A book's uploaded audiobook, from a place in the book on (M13 (d)). */
export type UploadedReading = ReadingPart & {
  importId: string;
  /** How the Listen bar names it among the voices: "upload:<importId>". */
  voice: string;
  title: string | null;
  /** Its audio files, each played from one address (see the audio route). */
  files: { url: string; mime: string }[];
  /** Where the next part of `paragraphs` is asked for (add `?from=<more>`). */
  partsUrl: string;
};

/**
 * Paragraphs are sent in parts of this many (a whole book's word times are a
 * few MB): the Listen bar asks for the next part well before it reaches the
 * end of the one it has.
 */
export const READING_PART = 200;
/**
 * ...and of about this many words at most (always at least one paragraph):
 * a PDF "paragraph" is often a whole page (Kuhn's are marked by indents, not
 * space), so 200 of them would be most of a book. 8,000 words is about an
 * hour of listening and about 300 KB of times and places.
 */
export const READING_WORDS = 8000;

async function readyImport(db: Db, ownerId: string, bookId: string, importId?: string) {
  const [imp] = await db
    .select({ id: readalongImports.id, title: readalongImports.title, audio: readalongImports.audio })
    .from(readalongImports)
    .where(
      and(
        eq(readalongImports.ownerId, ownerId),
        eq(readalongImports.bookId, bookId),
        eq(readalongImports.status, "ready"),
        ...(importId ? [eq(readalongImports.id, importId)] : []),
      ),
    )
    .orderBy(desc(readalongImports.createdAt))
    .limit(1);
  return imp ?? null;
}

/**
 * The book's uploaded audiobook (the newest finished import; a finished
 * import replaces the earlier ones), with the first part of the paragraphs
 * it reads from `fromPosition` (a sections.position) on. Paragraphs where no
 * spoken word matched have no track and are not listed; nor is any track
 * without words. The audio is served by
 * app/api/books/[id]/readalong/[importId]/audio/[n], further parts by
 * .../reading (see readingPart).
 */
export async function uploadedReading(
  db: Db,
  ownerId: string,
  bookId: string,
  fromPosition: number,
  part = READING_PART,
  words = READING_WORDS,
): Promise<UploadedReading | null> {
  const imp = await readyImport(db, ownerId, bookId);
  if (!imp) return null;
  return {
    importId: imp.id,
    voice: `upload:${imp.id}`,
    title: imp.title,
    files: imp.audio.map((a, i) => ({ url: `/api/books/${bookId}/readalong/${imp.id}/audio/${i}`, mime: a.mime })),
    partsUrl: `/api/books/${bookId}/readalong/${imp.id}/reading`,
    ...(await paragraphsOf(db, ownerId, bookId, imp, fromPosition, part, words)),
  };
}

/** The next part of a finished import's paragraphs, from `fromPosition` on; null if the import is not this owner's, or not finished. */
export async function readingPart(
  db: Db,
  ownerId: string,
  bookId: string,
  importId: string,
  fromPosition: number,
  part = READING_PART,
  words = READING_WORDS,
): Promise<ReadingPart | null> {
  const imp = await readyImport(db, ownerId, bookId, importId);
  return imp ? paragraphsOf(db, ownerId, bookId, imp, fromPosition, part, words) : null;
}

async function paragraphsOf(
  db: Db,
  ownerId: string,
  bookId: string,
  imp: { id: string; audio: { key: string }[] },
  fromPosition: number,
  part: number,
  words: number,
): Promise<ReadingPart> {
  const rows = await db
    .select({
      sectionId: audioTracks.sectionId,
      audioKey: audioTracks.audioKey,
      startMs: audioTracks.audioStartMs,
      endMs: audioTracks.audioEndMs,
      words: audioTracks.words,
      cfi: sections.cfi,
      chapterIndex: sections.chapterIndex,
      position: sections.position,
      text: sections.text,
    })
    .from(audioTracks)
    .innerJoin(sections, and(eq(sections.bookId, audioTracks.bookId), eq(sections.id, audioTracks.sectionId)))
    .where(
      and(
        eq(audioTracks.ownerId, ownerId),
        eq(audioTracks.bookId, bookId),
        eq(audioTracks.importId, imp.id),
        gte(sections.position, fromPosition),
      ),
    )
    .orderBy(asc(sections.position))
    .limit(part + 1);
  // Up to `part` paragraphs, stopping once `words` words are in (at least one paragraph).
  let kept = 0;
  let count = 0;
  while (kept < Math.min(rows.length, part) && (kept === 0 || count < words)) count += rows[kept++].words.length;
  const taken = rows.slice(0, kept);
  const fileOf = new Map(imp.audio.map((a, i) => [a.key, i]));
  const [book] = await db.select({ fileType: books.fileType }).from(books).where(eq(books.id, bookId));
  const pages = book?.fileType === "pdf" && taken.length ? await pageOffsets(db, bookId, new Set(taken.map((r) => r.chapterIndex))) : null;
  const paragraphs: ReadingParagraph[] = [];
  for (const r of taken) {
    const file = fileOf.get(r.audioKey);
    if (file === undefined || !r.words.length || r.startMs === null || r.endMs === null) continue;
    const p: ReadingParagraph = {
      sectionId: r.sectionId,
      cfi: r.cfi,
      chapterIndex: r.chapterIndex,
      position: r.position,
      text: r.text,
      file,
      startMs: r.startMs,
      endMs: r.endMs,
      words: r.words,
    };
    if (pages) {
      const at = pages.get(r.sectionId);
      if (!at) continue;
      p.inPage = r.words.map(([, , from, to]) => [at.base + at.before[from], at.base + at.before[to]]);
    }
    paragraphs.push(p);
  }
  return { paragraphs, more: rows[kept]?.position ?? null, chapters: await chapterNames(db, bookId, new Set(paragraphs.map((p) => p.chapterIndex))) };
}

/** The name of each chapter (EPUB spine item) or page (PDF, "Page 3") in `indexes`, as the book's sections name them. */
export async function chapterNames(db: Db, bookId: string, indexes: Set<number>): Promise<Record<number, string>> {
  if (!indexes.size) return {};
  const rows = await db
    .select({ chapterIndex: sections.chapterIndex, label: sections.label })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "chapter"), inArray(sections.chapterIndex, [...indexes])));
  return Object.fromEntries(rows.filter((r) => r.label.trim()).map((r) => [r.chapterIndex, r.label.trim()]));
}

/**
 * For PDF paragraphs on the given pages (M13 (e)): where each paragraph
 * starts on its page in non-space characters (the paragraphs before it on
 * that page), and the count before each position of its own text.
 */
async function pageOffsets(db: Db, bookId: string, pages: Set<number>) {
  const rows = await db
    .select({ id: sections.id, chapterIndex: sections.chapterIndex, text: sections.text })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph"), inArray(sections.chapterIndex, [...pages])))
    .orderBy(asc(sections.position));
  const out = new Map<string, { base: number; before: number[] }>();
  let page = -1;
  let base = 0;
  for (const r of rows) {
    if (r.chapterIndex !== page) {
      page = r.chapterIndex;
      base = 0;
    }
    const before = nonSpaceBefore(r.text);
    out.set(r.id, { base, before });
    base += before[r.text.length];
  }
  return out;
}
