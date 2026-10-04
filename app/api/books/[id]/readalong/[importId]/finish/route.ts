import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { finishImport } from "@/lib/readalong/importer";
import { bodyBytes, isId, readalongError } from "@/lib/readalong/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Finishes an import once every part is sent: { parts: { "audio/01.m4b": [{ part, tag }, …] } }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; importId: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id: bookId, importId } = await params;
  if (!isId(bookId) || !isId(importId)) return Response.json({ error: "Import not found" }, { status: 404 });
  // The parts list is small (at most 10,000 parts of about 50 bytes each), so
  // anything over 2 MB is refused before it is parsed.
  const raw = await bodyBytes(req, 2 * 1024 * 1024);
  if (raw instanceof Response) return raw;
  let body: { parts?: unknown } = {};
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as { parts?: unknown };
  } catch {
    return Response.json({ error: "List each file's parts as { part, tag }." }, { status: 400 });
  }
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
