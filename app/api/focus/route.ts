import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { FocusError, focusJson, openFocus, startFocus } from "@/lib/library/focus-lock";

export const dynamic = "force-dynamic";

/**
 * The reader's focus session, kept on the server (M26 R4a).
 * GET: the open session ({ session: null } when there is none), with the milliseconds left by the server's clock.
 * POST { bookId, question, minutes }: starts one; 409 while another is running.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const open = await openFocus(await getDb(), user.id);
  return Response.json({ session: open ? focusJson(open) : null }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const row = await startFocus(await getDb(), user.id, { bookId: body.bookId, question: body.question, minutes: body.minutes });
    return Response.json({ session: focusJson(row) }, { status: 201 });
  } catch (e) {
    if (e instanceof FocusError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
