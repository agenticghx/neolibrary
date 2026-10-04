import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { markQuestion, QuestionsError } from "@/lib/library/questions";

export const dynamic = "force-dynamic";

/** Marks a question right or wrong: { generationId, index, correct }. Returns the book's latest marks. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    return Response.json({ marks: await markQuestion(await getDb(), user.id, body) });
  } catch (e) {
    if (e instanceof QuestionsError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
