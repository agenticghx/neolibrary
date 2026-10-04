import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listImports, MAX_ZIP_BYTES, PART_BYTES, startImport } from "@/lib/readalong/importer";
import { bodyBytes, isId, readalongError } from "@/lib/readalong/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** The book's uploaded read-along audiobooks (M13), newest first. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  try {
    return Response.json({ imports: await listImports(await getDb(), user.id, bookId), partBytes: PART_BYTES });
  } catch (e) {
    return readalongError(e);
  }
}

/**
 * Starts an import: the body is the package as a zip. Audio left out of the
 * zip is then sent in parts (PUT …/parts) and the import finished
 * (POST …/finish). Answers with the import, its match report, and the audio
 * files it is waiting for.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const zip = await bodyBytes(req, MAX_ZIP_BYTES);
  if (zip instanceof Response) return zip;
  try {
    const out = await startImport(await getDb(), await getStorage(), user.id, bookId, zip);
    return Response.json({ import: out, partBytes: PART_BYTES }, { status: 201 });
  } catch (e) {
    return readalongError(e);
  }
}
