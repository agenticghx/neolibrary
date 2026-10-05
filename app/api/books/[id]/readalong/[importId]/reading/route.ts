import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { readingPart } from "@/lib/library/audio";
import { isId } from "@/lib/readalong/http";

export const dynamic = "force-dynamic";

/**
 * The next part of an uploaded audiobook's paragraphs, from `?from=<position>`
 * on (M13 (d)): the Listen bar asks for it before it reaches the end of the
 * part it has. To the book's owner only, for a finished import. This path
 * skips proxy.ts (see its matcher), so the sign-in check comes first here.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; importId: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id: bookId, importId } = await params;
  if (!isId(bookId) || !isId(importId)) return Response.json({ error: "Not found" }, { status: 404 });
  const from = Number(new URL(req.url).searchParams.get("from") ?? "");
  if (!Number.isInteger(from) || from < 0) return Response.json({ error: "Say where to start: ?from=<position>." }, { status: 400 });
  const part = await readingPart(await getDb(), user.id, bookId, importId, from);
  if (!part) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(part);
}
