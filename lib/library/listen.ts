import { and, count, eq, gt, lt } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { sections } from "@/lib/db/schema";
import { getSpeechModel } from "@/lib/speech";
import { SpeechNotConfigured, type SpeechModel } from "@/lib/speech/model";
import { estimateSpeech, passageFor, storedTrack, uploadedReading, type Track, type UploadedReading } from "./audio";

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
  /** The paragraph at the reading position (or `section`), and the one after it. */
  passage: { id: string; cfi: string; position: number; nextId: string | null; characters: number };
  /** "Your audiobook" first when the book has one, then the made-on-demand voices (none without a voice key). */
  voices: { id: string; name: string }[];
  /** The stored made-on-demand track for `voice` (or the first such voice), if any. */
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
  // Only when the bar opens (a place in the book): reading on in a made voice asks by `section`.
  const reading = q.cfi ? await uploadedReading(db, ownerId, bookId, passage.position) : null;
  const audiobook = reading ? { ...reading, begins: await beginsAt(db, bookId, passage, reading.paragraphs[0]) } : null;
  let voices: { id: string; name: string }[] = [];
  let track: Track | null = null;
  let configured = true;
  try {
    const model = speech();
    voices = await model.voices();
    const voice = q.voice && !q.voice.startsWith("upload:") ? q.voice : voices[0]?.id;
    if (voice) track = await storedTrack(db, ownerId, model, voice, passage);
  } catch (e) {
    if (!(e instanceof SpeechNotConfigured)) throw e;
    configured = false;
  }
  return {
    passage: { id: passage.id, cfi: passage.cfi, position: passage.position, nextId: passage.nextId, characters: passage.text.length },
    voices: audiobook ? [{ id: audiobook.voice, name: AUDIOBOOK_NAME }, ...voices] : voices,
    track,
    estimate: configured ? estimateSpeech(passage) : null,
    audiobook,
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
