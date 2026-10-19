import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { cancelWait, focusJson, startWait } from "@/lib/library/focus-lock";

export const dynamic = "force-dynamic";

/**
 * The wait to leave a focus session early (M26 R4b), kept on the server so a reload or another device does not
 * skip it. POST { id }: Leave early starts it (asking again keeps the first wait). DELETE { id }: Keep reading
 * cancels it. Both answer with the session as it now stands.
 */
async function handle(req: Request, change: typeof startWait | typeof cancelWait) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const row = await change(await getDb(), user.id, body.id);
  if (!row) return Response.json({ error: "No such focus session." }, { status: 404 });
  return Response.json({ session: focusJson(row) }, { headers: { "cache-control": "no-store" } });
}

export const POST = (req: Request) => handle(req, startWait);
export const DELETE = (req: Request) => handle(req, cancelWait);
