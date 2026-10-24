import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { FocusError, focusView, openFocus, startFocus } from "@/lib/library/focus-lock";

export const dynamic = "force-dynamic";

/**
 * The reader's focus session, kept on the server (M26 R4a).
 * GET: the open session ({ session: null } when there is none), with the milliseconds left by the server's clock.
 * POST { bookId, question, minutes }: starts one; 409 while another is running.
 * POST { bookId, question, kind: "book", days }: starts a whole-book focus (M26 R5), up to 30 days.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const db = await getDb();
  const open = await openFocus(db, user.id);
  return Response.json({ session: open ? await focusView(db, user.id, open) : null }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const db = await getDb();
    const row = await startFocus(db, user.id, { bookId: body.bookId, question: body.question, minutes: body.minutes, kind: body.kind, days: body.days });
    return Response.json({ session: await focusView(db, user.id, row) }, { status: 201 });
  } catch (e) {
    if (e instanceof FocusError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
