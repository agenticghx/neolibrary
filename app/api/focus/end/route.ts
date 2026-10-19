import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { endFocus, focusJson } from "@/lib/library/focus-lock";

export const dynamic = "force-dynamic";

/**
 * Ends a focus session (M26 R4a): { id }. Ending one already ended changes nothing. With an answer, the session
 * ends through POST /api/books/<id>/focus instead, which saves the note and ends it in one go.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ended = await endFocus(await getDb(), user.id, body.id, { answered: false });
  if (!ended) return Response.json({ error: "No such focus session." }, { status: 404 });
  return Response.json({ session: focusJson(ended) });
}
