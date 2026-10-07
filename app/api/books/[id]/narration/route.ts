import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { narrationSummary, NarrationError, startNarration, stopNarration } from "@/lib/library/narration";
import { getSpeechModel } from "@/lib/speech";
import { SpeechError, SpeechNotConfigured } from "@/lib/speech/model";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Whole-book AI narration (M14 follow-up V5), for the book's owner only, EPUB
 * only. GET: what it involves (paragraphs, characters, cost, what is saved,
 * the spending limits) and whether it is going on. POST { voice, confirm:
 * true }: starts it in the background (refused without confirm: true). DELETE
 * ?voice=: stops it. Another reader's book, or none, is "not found" (404).
 */
const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

function errorResponse(e: unknown) {
  if (e instanceof NarrationError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof SpeechNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof SpeechError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

async function signedIn(params: Promise<{ id: string }>) {
  const user = await currentUser();
  if (!user) return { error: Response.json({ error: "Sign in required" }, { status: 401 }) };
  const bookId = (await params).id;
  if (!isId(bookId)) return { error: Response.json({ error: "Book not found" }, { status: 404 }) };
  return { error: null, user, bookId };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const at = await signedIn(params);
  if (at.error) return at.error;
  try {
    const voice = new URL(req.url).searchParams.get("voice");
    return Response.json(await narrationSummary(await getDb(), getSpeechModel(), at.user.id, at.bookId, voice));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const at = await signedIn(params);
  if (at.error) return at.error;
  const body = (await req.json().catch(() => ({}))) as { voice?: unknown; confirm?: unknown };
  try {
    const db = await getDb();
    const model = getSpeechModel();
    const voice = typeof body.voice === "string" ? body.voice : "";
    const { started } = await startNarration({ db, storage: await getStorage(), model }, at.user.id, at.bookId, voice, body.confirm);
    // 202: started, going on in the background; 200: it was going on already.
    return Response.json(await narrationSummary(db, model, at.user.id, at.bookId, voice), { status: started ? 202 : 200 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const at = await signedIn(params);
  if (at.error) return at.error;
  const voice = new URL(req.url).searchParams.get("voice");
  if (!voice) return Response.json({ error: "Say which voice to stop (?voice=)." }, { status: 400 });
  try {
    const db = await getDb();
    await stopNarration(db, at.user.id, at.bookId, voice);
    return Response.json(await narrationSummary(db, getSpeechModel(), at.user.id, at.bookId, voice));
  } catch (e) {
    return errorResponse(e);
  }
}
