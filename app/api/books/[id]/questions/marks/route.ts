import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { markQuestion, QuestionsError } from "@/lib/library/questions";

export const dynamic = "force-dynamic";

/** Marks a question right or wrong: { generationId, index, correct }. Returns the book's latest marks. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const raw = await req.json().catch(() => null);
  const body = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as { generationId?: unknown; index?: unknown; correct?: unknown };
  try {
    return Response.json({ marks: await markQuestion(await getDb(), user.id, { generationId: body.generationId, index: body.index, correct: body.correct, bookId: (await params).id }) });
  } catch (e) {
    if (e instanceof QuestionsError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
