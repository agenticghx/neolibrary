import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { cappedFormData } from "@/lib/http-body";
import { AnnotationError } from "@/lib/library/annotations";
import { createVoiceNote, MAX_BYTES, MAX_NOTE_REQUEST_BYTES } from "@/lib/library/voice-notes";
import { SpeechNotConfigured } from "@/lib/speech/model";
import { getTranscriber, type Transcriber } from "@/lib/speech/transcribe";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Saves a voice note on a passage. A form upload with: "audio" (the
 * recording), "cfi", "quote" (JSON: exact, prefix, suffix), "durationMs" and
 * an optional typed "body".
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  const form = await cappedFormData(req, MAX_NOTE_REQUEST_BYTES);
  if (form instanceof Response) return form;
  const audio = form.get("audio");
  if (!(audio instanceof File)) return Response.json({ error: "No recording received." }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: "Voice notes can be at most 10 MB." }, { status: 400 });
  let quote: { exact?: unknown; prefix?: unknown; suffix?: unknown } = {};
  try {
    quote = JSON.parse(String(form.get("quote") ?? "{}"));
  } catch {
    // No quote: the note still attaches to the place (CFI).
  }
  let transcriber: Transcriber | null = null;
  try {
    transcriber = getTranscriber();
  } catch (e) {
    if (!(e instanceof SpeechNotConfigured)) throw e;
  }
  try {
    const out = await createVoiceNote(await getDb(), await getStorage(), transcriber, user.id, {
      bookId,
      cfi: form.get("cfi"),
      quote,
      body: form.get("body") ?? "",
      audio: new Uint8Array(await audio.arrayBuffer()),
      mime: audio.type || "audio/webm",
      durationMs: Number(form.get("durationMs")),
    });
    return Response.json(out, { status: 201 });
  } catch (e) {
    if (e instanceof AnnotationError) return Response.json({ error: e.message }, { status: e.message === "Book not found." ? 404 : 400 });
    throw e;
  }
}
