import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { savePosition } from "@/lib/library/reading";

export const dynamic = "force-dynamic";

/** Saves where the reader is: { cfi, fraction }. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ok = await savePosition(await getDb(), user.id, (await params).id, body ?? {});
  return ok ? new Response(null, { status: 204 }) : Response.json({ error: "Not saved" }, { status: 400 });
}
