import { and, eq } from "drizzle-orm";
import { capsFromEnv, checkCaps, SpendingCapReached, type Caps } from "@/lib/ai/generate";
import { sha256 } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { books, generations } from "@/lib/db/schema";
import { SpeechError } from "@/lib/speech/model";
import { sttCost, type Transcriber } from "@/lib/speech/transcribe";
import type { Storage } from "@/lib/storage";
import { AnnotationError, createAnnotation, type Annotation } from "./annotations";
import { isCfi } from "./reading";

/**
 * Voice notes on a passage (M8): the recording is stored (never in the
 * database), turned into text so it can be searched, and saved as an
 * annotation of kind "voice". The transcript is machine-made, so it is stored
 * with its provenance like every AI output (ground rule 5) and counts against
 * the voice caps (ground rule 8). If transcription is not possible, the note
 * is still saved: nothing the reader said is lost.
 */
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_MS = 10 * 60 * 1000;
const TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export async function createVoiceNote(
  db: Db,
  storage: Storage,
  transcriber: Transcriber | null,
  ownerId: string,
  input: { bookId: string; cfi: unknown; quote?: { exact?: unknown; prefix?: unknown; suffix?: unknown }; body?: unknown; audio: Uint8Array; mime: string; durationMs: number },
  opts: { caps?: Caps; now?: () => Date } = {},
): Promise<{ annotation: Annotation; transcribed: boolean; problem: string | null }> {
  const mime = input.mime.split(";")[0].trim().toLowerCase();
  const ext = TYPES[mime];
  if (!ext) throw new AnnotationError("That recording is not in an audio format the app can keep.");
  if (!input.audio.length) throw new AnnotationError("The recording is empty.");
  if (input.audio.length > MAX_BYTES) throw new AnnotationError("Voice notes can be at most 10 MB.");
  const durationMs = Math.max(0, Math.min(Number(input.durationMs) || 0, MAX_MS));
  const now = opts.now?.() ?? new Date();
  // Check the book before paying for a transcript.
  const mine = /^[0-9a-f-]{36}$/i.test(input.bookId)
    ? await db.select({ id: books.id }).from(books).where(and(eq(books.id, input.bookId), eq(books.ownerId, ownerId)))
    : [];
  if (!mine.length) throw new AnnotationError("Book not found.");
  if (!isCfi(input.cfi)) throw new AnnotationError("That is not a place in the book.");
  const id = crypto.randomUUID();
  const audioKey = `audio/${ownerId}/${input.bookId}/notes/${id}.${ext}`;

  let transcript = "";
  let problem: string | null = null;
  if (transcriber) {
    try {
      await checkCaps(db, transcriber.provider, input.bookId, sttCost(durationMs), opts.caps ?? capsFromEnv(process.env, "VOICE"), now, "voice");
      transcript = await transcriber.transcribe(input.audio, mime);
    } catch (e) {
      if (!(e instanceof SpeechError || e instanceof SpendingCapReached)) throw e;
      problem = `Saved without a transcript: ${e.message}`;
    }
  } else problem = "Saved without a transcript: transcripts are not set up yet.";

  const annotation = await createAnnotation(
    db,
    ownerId,
    { kind: "voice", bookId: input.bookId, cfi: input.cfi, quote: input.quote, body: input.body, voice: { audioKey, mime, durationMs, transcript } },
    now,
    id,
  );
  await storage.put(audioKey, input.audio, mime);
  if (transcriber && !problem) {
    await db.insert(generations).values({
      ownerId,
      bookId: input.bookId,
      sectionId: annotation.sectionId,
      kind: "transcript",
      options: {},
      cacheKey: sha256(`transcript|${id}`),
      provider: transcriber.provider,
      model: transcriber.model,
      promptName: "speech-to-text",
      promptHash: "",
      inputHash: sha256(Buffer.from(input.audio).toString("base64")),
      outputTokens: 0,
      inputTokens: 0,
      costUsd: sttCost(durationMs),
      output: transcript,
      createdAt: now,
    });
  }
  return { annotation, transcribed: !problem, problem };
}
