import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { finishImport } from "@/lib/readalong/importer";
import { isId, readalongError } from "@/lib/readalong/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Finishes an import once every part is sent: { parts: { "audio/01.m4b": [{ part, tag }, …] } }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; importId: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id: bookId, importId } = await params;
  if (!isId(bookId) || !isId(importId)) return Response.json({ error: "Import not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { parts?: unknown };
  const parts = body.parts && typeof body.parts === "object" ? (body.parts as Record<string, { part: number; tag: string }[]>) : {};
  for (const list of Object.values(parts)) {
    if (!Array.isArray(list) || list.some((p) => !Number.isInteger(p?.part) || typeof p?.tag !== "string")) {
      return Response.json({ error: "List each file's parts as { part, tag }." }, { status: 400 });
    }
  }
  try {
    return Response.json({ import: await finishImport(await getDb(), await getStorage(), user.id, bookId, importId, parts) });
  } catch (e) {
    return readalongError(e);
  }
}
