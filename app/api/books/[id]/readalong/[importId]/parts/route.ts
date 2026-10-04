import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { MAX_PART_BYTES, putAudioPart } from "@/lib/readalong/importer";
import { bodyBytes, isId, readalongError } from "@/lib/readalong/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** One part of an audio file: PUT …/parts?file=audio/01.m4b&part=N with the bytes as the body. Answers { part, tag }. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string; importId: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id: bookId, importId } = await params;
  if (!isId(bookId) || !isId(importId)) return Response.json({ error: "Import not found" }, { status: 404 });
  const url = new URL(req.url);
  const file = url.searchParams.get("file") ?? "";
  const part = Number(url.searchParams.get("part"));
  const bytes = await bodyBytes(req, MAX_PART_BYTES);
  if (bytes instanceof Response) return bytes;
  try {
    return Response.json(await putAudioPart(await getDb(), await getStorage(), user.id, bookId, importId, file, part, bytes));
  } catch (e) {
    return readalongError(e);
  }
}
