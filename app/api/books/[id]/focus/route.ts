import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { AnnotationError, createAnnotationOnce } from "@/lib/library/annotations";
import { linkFocusAnswer, StatsError } from "@/lib/library/reading-stats";
import { focusNoteBody } from "@/lib/reader/focus-session";

export const dynamic = "force-dynamic";

/**
 * The end of a focus session (M26 R3): { focusId, noteId, question, answer }. The answer is saved as a note on
 * the whole book (the reader's own, so it is never overwritten and becomes a Daily review card), and the sittings
 * read during the session point at it. The note's id is the reader's, so a retry saves nothing twice.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!answer) return Response.json({ error: "Write your answer first." }, { status: 400 });
  const db = await getDb();
  try {
    const { annotation } = await createAnnotationOnce(db, user.id, body.noteId, { kind: "note", bookId: (await params).id, body: focusNoteBody(question, answer) });
    const sittings = await linkFocusAnswer(db, user.id, body.focusId, annotation.id);
    return Response.json({ note: annotation, sittings }, { status: 201 });
  } catch (e) {
    if (e instanceof AnnotationError || e instanceof StatsError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
