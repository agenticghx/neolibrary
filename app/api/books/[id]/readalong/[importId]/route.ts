import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { deleteImport } from "@/lib/readalong/importer";
import { isId, readalongError } from "@/lib/readalong/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Removes an uploaded audiobook, its read-aloud tracks and its audio files (M13). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; importId: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id: bookId, importId } = await params;
  if (!isId(bookId) || !isId(importId)) return Response.json({ error: "Import not found" }, { status: 404 });
  try {
    await deleteImport(await getDb(), await getStorage(), user.id, bookId, importId);
    return new Response(null, { status: 204 });
  } catch (e) {
    return readalongError(e);
  }
}
