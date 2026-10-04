import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ImportError } from "@/lib/library/ebook";
import { importBook, type ImportResult } from "@/lib/library/import";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

export type UploadOutcome = { file: string } & (ImportResult | { status: "error"; message: string });

/** Upload one or more EPUB/PDF files (multipart field "files"). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send the files as a form upload." }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "No files received." }, { status: 400 });

  const db = await getDb();
  const storage = await getStorage();
  const results: UploadOutcome[] = [];
  for (const f of files) {
    try {
      const r = await importBook(db, storage, user.id, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
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
