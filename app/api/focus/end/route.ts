import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { endFocus, FocusError, focusJson } from "@/lib/library/focus-lock";

export const dynamic = "force-dynamic";

/**
 * Ends a focus session without an answer (M26 R4a): { id }. Only once its time is up or its wait has run out
 * (M26 R4b); before then it is refused (409), with the session as it stands. Ending one already ended changes
 * nothing. With an answer, the session ends through POST /api/books/<id>/focus instead, which saves the note and
 * ends it in one go.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const ended = await endFocus(await getDb(), user.id, body.id, { answered: false });
    if (!ended) return Response.json({ error: "No such focus session." }, { status: 404 });
    return Response.json({ session: focusJson(ended) });
  } catch (e) {
    if (e instanceof FocusError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
