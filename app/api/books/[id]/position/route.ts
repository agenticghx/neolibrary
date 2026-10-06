import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { savePosition, savePositionAt } from "@/lib/library/reading";

export const dynamic = "force-dynamic";

/** Saves where the reader is: { cfi, fraction }; or, listening away from the reader, at a paragraph: { sectionId }. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const bookId = (await params).id;
  const ok =
    body && typeof body === "object" && "sectionId" in body
      ? await savePositionAt(await getDb(), user.id, bookId, body.sectionId)
      : await savePosition(await getDb(), user.id, bookId, body ?? {});
  return ok ? new Response(null, { status: 204 }) : Response.json({ error: "Not saved" }, { status: 400 });
}
