import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getPreferences, PreferencesError, setPreferences } from "@/lib/library/preferences";

export const dynamic = "force-dynamic";

/** The signed-in reader's reading preferences (M17): { aiStyle, rewrittenView }. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json(await getPreferences(await getDb(), user.id));
}

/** Changes the AI explanations style for all books, the view a book opens in, or both. */
export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { aiStyle?: unknown; rewrittenView?: unknown };
  try {
    return Response.json(await setPreferences(await getDb(), user.id, { aiStyle: body.aiStyle, rewrittenView: body.rewrittenView }));
  } catch (e) {
    if (e instanceof PreferencesError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
