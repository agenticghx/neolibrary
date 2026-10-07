import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { readingPart, readingPartBefore } from "@/lib/library/audio";
import { isId } from "@/lib/readalong/http";

export const dynamic = "force-dynamic";

/**
 * A part of an uploaded audiobook's paragraphs (M13 (d)): from `?from=<position>`
 * on (the Listen bar asks for it before it reaches the end of the part it
 * has), or just before `?before=<position>` (going back from where the reading
 * began). To the book's owner only, for a finished import. This path skips
 * proxy.ts (see its matcher), so the sign-in check comes first here.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; importId: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id: bookId, importId } = await params;
  if (!isId(bookId) || !isId(importId)) return Response.json({ error: "Not found" }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const before = q.get("before");
  // Exactly one of the two.
  const at = Number((before ?? q.get("from")) ?? "");
  if ((before !== null && q.has("from")) || !Number.isInteger(at) || at < 0) {
    return Response.json({ error: "Say where to start: ?from=<position>, or where to end: ?before=<position>." }, { status: 400 });
  }
  const db = await getDb();
  const part = before !== null ? await readingPartBefore(db, user.id, bookId, importId, at) : await readingPart(db, user.id, bookId, importId, at);
  if (!part) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(part);
}
