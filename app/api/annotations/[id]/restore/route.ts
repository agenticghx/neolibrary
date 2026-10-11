import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { AnnotationError, restoreAnnotation } from "@/lib/library/annotations";

export const dynamic = "force-dynamic";

/** Brings back a removed annotation (M19: Undo, and Bring back on Your data). `?changeId=` makes a resend harmless. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const changeId = new URL(req.url).searchParams.get("changeId") ?? undefined;
    return Response.json(await restoreAnnotation(await getDb(), user.id, (await params).id, new Date(), changeId));
  } catch (e) {
    if (e instanceof AnnotationError) return Response.json({ error: e.message }, { status: e.message.includes("not found") ? 404 : 400 });
    throw e;
  }
}
