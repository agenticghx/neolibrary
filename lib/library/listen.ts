import { and, count, eq, gt, lt } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { books, sections } from "@/lib/db/schema";
import { getSpeechModel } from "@/lib/speech";
import { SpeechNotConfigured, type SpeechModel } from "@/lib/speech/model";
import { chapterNames, estimateSpeech, firstStoredTrack, passageFor, storedTrack, uploadedReading, type Track, type UploadedReading } from "./audio";

/** What the Listen bar shows for "Your audiobook" among the voices (M13 (d)). */
export const AUDIOBOOK_NAME = "Your audiobook";

/**
 * The audiobook is offered first when it begins near the reading position:
 * in the same chapter, or within this many paragraphs. Further on, the bar
 * says where it begins, so Play does not take the reader chapters ahead
 * unawares (and move their reading position there).
 */
export const NEARBY_PARAGRAPHS = 10;

export type ListenInfo = {
  /**
   * The paragraph at the reading position (or `section`), the ones after and
   * before it, and (M14 step 6b, for the mini-player away from the page) its
   * text and its chapter's name ("" when the book gives it none).
   */
  passage: { id: string; cfi: string; position: number; nextId: string | null; prevId: string | null; characters: number; text: string; chapter: string };
  /** The book (M14 step 6b: the mini-player names it). */
  book: { title: string; author: string };
  /** "Your audiobook" first when the book has one, then the made-on-demand voices (none without a voice key). */
  voices: { id: string; name: string }[];
  /** The stored made-on-demand track for `voice`, if any; with no voice asked, the one in the first voice this paragraph is saved in. */
  track: Track | null;
  /** What making this paragraph's audio would cost; null when no voice key is set. */
  estimate: number | null;
  /**
   * The book's uploaded audiobook from the reading position on (asked for
   * with `cfi` only). `begins`: when its first timed paragraph is not the
   * one at the reading position, the name of the chapter (or page) where it
   * begins, and whether that is near.
   */
  audiobook: (UploadedReading & { begins: { label: string; nearby: boolean } | null }) | null;
  /** In a PDF book only the audiobook is offered: a made voice's word times could not be placed on a PDF page yet. */
  fileType: "epub" | "pdf";
};

/**
 * Everything the Listen bar needs to start (M7, M13 (d)): the paragraph to
 * read at `cfi` (or `section`), the voices, any stored track, the cost, and
 * the book's own audiobook. The audiobook is looked up before the voice
 * service is asked for anything: with no ElevenLabs key that throws
 * SpeechNotConfigured, and the audiobook must still play (it costs nothing).
 */
export async function listenInfo(
  db: Db,
  ownerId: string,
  bookId: string,
  q: { cfi?: string | null; section?: string | null; voice?: string | null },
  speech: () => SpeechModel = getSpeechModel,
): Promise<ListenInfo> {
  const passage = await passageFor(db, ownerId, bookId, q.cfi ? { cfi: q.cfi } : { sectionId: q.section ?? "" });
  const [book] = await db.select({ fileType: books.fileType, title: books.title, author: books.author }).from(books).where(eq(books.id, bookId));
  const fileType = book?.fileType === "pdf" ? "pdf" : "epub";
  // Only when the bar opens (a place in the book): reading on in a made voice asks by `section`.
  const reading = q.cfi ? await uploadedReading(db, ownerId, bookId, passage.position) : null;
  const audiobook = reading ? { ...reading, begins: await beginsAt(db, bookId, passage, reading.paragraphs[0]) } : null;
  let voices: { id: string; name: string }[] = [];
  let track: Track | null = null;
  let configured = fileType === "epub";
  if (configured) {
    try {
      const model = speech();
      voices = await model.voices();
      if (q.voice && !q.voice.startsWith("upload:")) track = await storedTrack(db, ownerId, model, q.voice, passage);
      // No voice asked (the bar opening): the first voice this paragraph is saved in, so the bar opens in a voice
      // that plays it for free (a book narrated whole in a voice that is not the first on offer); none saved: none.
      else track = await firstStoredTrack(db, ownerId, model, voices.map((v) => v.id), passage);
    } catch (e) {
      if (!(e instanceof SpeechNotConfigured)) throw e;
      configured = false;
    }
  }
  const chapter = (await chapterNames(db, bookId, new Set([passage.chapterIndex])))[passage.chapterIndex] ?? "";
  return {
    passage: {
      id: passage.id,
      cfi: passage.cfi,
      position: passage.position,
      nextId: passage.nextId,
      prevId: passage.prevId,
      characters: passage.text.length,
      text: passage.text,
      chapter,
    },
    book: { title: book?.title ?? "", author: book?.author ?? "" },
    voices: audiobook ? [{ id: audiobook.voice, name: AUDIOBOOK_NAME }, ...voices] : voices,
    track,
    estimate: configured ? estimateSpeech(passage) : null,
    audiobook,
    fileType,
  };
}

/** Where an audiobook begins, when that is not at the reading position: its chapter's (or PDF page's) name, and whether it is near. */
async function beginsAt(db: Db, bookId: string, at: { position: number; chapterIndex: number }, first: { position: number; chapterIndex: number } | undefined) {
  if (!first || first.position <= at.position) return null;
  const [between] = await db
    .select({ n: count() })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "paragraph"), gt(sections.position, at.position), lt(sections.position, first.position)));
  const [chapter] = await db
    .select({ label: sections.label })
    .from(sections)
    .where(and(eq(sections.bookId, bookId), eq(sections.kind, "chapter"), eq(sections.chapterIndex, first.chapterIndex)));
  return {
    label: chapter?.label.trim() || "further on in the book",
    nearby: first.chapterIndex === at.chapterIndex || Number(between?.n ?? 0) < NEARBY_PARAGRAPHS,
  };
}
