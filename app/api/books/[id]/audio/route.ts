import { SpendingCapReached } from "@/lib/ai/generate";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { AudioError, speakPassage, type Track } from "@/lib/library/audio";
import { listenInfo } from "@/lib/library/listen";
import { isCfi } from "@/lib/library/reading";
import { serverSecret } from "@/lib/secrets";
import { signFileUrl } from "@/lib/signed-url";
import { getSpeechModel } from "@/lib/speech";
import { SpeechError, SpeechNotConfigured } from "@/lib/speech/model";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

async function withUrl(track: Track | null) {
  if (!track) return null;
  const secret = await serverSecret(await getDb(), "file-links");
  return { ...track, audioUrl: signFileUrl(secret, track.audioKey) };
}

function errorResponse(e: unknown) {
  if (e instanceof AudioError) return Response.json({ error: e.message }, { status: e.message === "Book not found" ? 404 : 400 });
  if (e instanceof SpendingCapReached) return Response.json({ error: e.message }, { status: 429 });
  if (e instanceof SpeechNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof SpeechError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

/**
 * The paragraph to read at `?cfi=` (or `?section=`), the next one, the voices,
 * the stored track for `?voice=` if any (with a short-lived audio link), what
 * making it would cost, and (with `?cfi=`) the book's uploaded audiobook from
 * there on (M13 (d); its audio is served by the read-along audio route).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const url = new URL(req.url);
  const cfi = url.searchParams.get("cfi");
  try {
    const info = await listenInfo(await getDb(), user.id, bookId, {
      cfi: cfi && isCfi(cfi) ? cfi : null,
      section: url.searchParams.get("section"),
      voice: url.searchParams.get("voice"),
    });
    return Response.json({ ...info, track: await withUrl(info.track) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Reads a paragraph aloud (or re-serves the stored track): { sectionId, voice }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { sectionId?: unknown; voice?: unknown };
  if (typeof body.sectionId !== "string" || typeof body.voice !== "string") {
    return Response.json({ error: "Choose a paragraph and a voice." }, { status: 400 });
  }
  try {
    const out = await speakPassage(await getDb(), await getStorage(), getSpeechModel(), user.id, {
      bookId,
      sectionId: body.sectionId,
      voice: body.voice,
    });
    return Response.json({ track: await withUrl(out.track), reused: out.reused }, { status: out.reused ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
