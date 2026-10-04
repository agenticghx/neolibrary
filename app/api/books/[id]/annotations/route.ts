import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { AnnotationError, createAnnotation, listAnnotations } from "@/lib/library/annotations";
import { serverSecret } from "@/lib/secrets";
import { signFileUrl } from "@/lib/signed-url";

export const dynamic = "force-dynamic";

/** The signed-in user's current highlights, bookmarks and notes for a book. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(bookId)) return Response.json({ annotations: [] });
  const db = await getDb();
  const list = await listAnnotations(db, user.id, bookId);
  // Voice notes come with a short-lived link to their recording.
  const secret = list.some((a) => a.voice) ? await serverSecret(db, "file-links") : "";
  return Response.json({
    annotations: list.map((a) => (a.voice ? { ...a, audioUrl: signFileUrl(secret, a.voice.audioKey) } : a)),
  });
}

/** Adds a highlight, bookmark or note: { kind, cfi?, quote?, color?, body? }. Voice notes have their own route. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.kind === "voice") return Response.json({ error: "Send voice notes to /voice-notes." }, { status: 400 });
    const a = await createAnnotation(await getDb(), user.id, { ...body, bookId: (await params).id });
    return Response.json(a, { status: 201 });
  } catch (e) {
    if (e instanceof AnnotationError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
