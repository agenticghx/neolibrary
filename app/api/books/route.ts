import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { cappedFormData } from "@/lib/http-body";
import { ImportError, MAX_BOOK_REQUEST_BYTES } from "@/lib/library/ebook";
import { importBook, type ImportResult } from "@/lib/library/import";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

export type UploadOutcome = { file: string } & (ImportResult | { status: "error"; message: string });

/** Upload one or more EPUB/PDF files (multipart field "files"); "attachTo" names a title waiting for its file. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const form = await cappedFormData(req, MAX_BOOK_REQUEST_BYTES);
  if (form instanceof Response) return form;
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const attachTo = typeof form.get("attachTo") === "string" ? (form.get("attachTo") as string) : null;
  if (attachTo && files.length > 1) return Response.json({ error: "Send one file for a title." }, { status: 400 });
  if (!files.length) return Response.json({ error: "No files received." }, { status: 400 });

  const db = await getDb();
  const storage = await getStorage();
  const results: UploadOutcome[] = [];
  for (const f of files) {
    try {
      const r = await importBook(db, storage, user.id, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, { attachTo });
      results.push({ file: f.name, ...r });
    } catch (e) {
      if (!(e instanceof ImportError)) console.error("Upload failed", f.name, e);
      results.push({
        file: f.name,
        status: "error",
        message: e instanceof ImportError ? e.message : "Something went wrong reading this file.",
      });
    }
  }
  return Response.json({ results });
}
