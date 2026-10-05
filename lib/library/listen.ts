import type { Db } from "@/lib/db/client";
import { getSpeechModel } from "@/lib/speech";
import { SpeechNotConfigured, type SpeechModel } from "@/lib/speech/model";
import { estimateSpeech, passageFor, storedTrack, uploadedReading, type Track, type UploadedReading } from "./audio";

/** What the Listen bar shows for "Your audiobook" among the voices (M13 (d)). */
export const AUDIOBOOK_NAME = "Your audiobook";

export type ListenInfo = {
  /** The paragraph at the reading position (or `section`), and the one after it. */
  passage: { id: string; cfi: string; nextId: string | null; characters: number };
  /** "Your audiobook" first when the book has one, then the made-on-demand voices (none without a voice key). */
  voices: { id: string; name: string }[];
  /** The stored made-on-demand track for `voice` (or the first such voice), if any. */
  track: Track | null;
  /** What making this paragraph's audio would cost; null when no voice key is set. */
  estimate: number | null;
  /** The book's uploaded audiobook from the reading position on (asked for with `cfi` only). */
  audiobook: UploadedReading | null;
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
  const audiobook = q.cfi ? await uploadedReading(db, ownerId, bookId, passage.position) : null;
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
    passage: { id: passage.id, cfi: passage.cfi, nextId: passage.nextId, characters: passage.text.length },
    voices: audiobook ? [{ id: audiobook.voice, name: AUDIOBOOK_NAME }, ...voices] : voices,
    track,
    estimate: configured ? estimateSpeech(passage) : null,
    audiobook,
  };
}
