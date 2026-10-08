import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { jsonAtMost } from "@/lib/http-body";
import { ExportFormatError, exportLibrary, importLibrary, MAX_IMPORT_BYTES } from "@/lib/library/export";

export const dynamic = "force-dynamic";

/**
 * Brings back a library export into an empty library. Refuses to import over
 * existing data, so nothing is silently merged or overwritten (ground rule 9).
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const data = await jsonAtMost(req, MAX_IMPORT_BYTES);
  if (data instanceof Response) return data;
  const db = await getDb();
  const current = await exportLibrary(db, user.id);
  if (current.books.length || current.paths.length || current.collections.length || current.annotations?.length) {
    return Response.json({ error: "Your library is not empty. Importing only works into an empty library." }, { status: 409 });
  }
  try {
    await importLibrary(db, user.id, data);
  } catch (e) {
    if (e instanceof ExportFormatError) return Response.json({ error: e.message }, { status: 400 });
    console.error("Import failed", e);
    return Response.json({ error: "The import failed and nothing was changed." }, { status: 400 });
  }
  const after = await exportLibrary(db, user.id);
  return Response.json({ books: after.books.length, paths: after.paths.length, collections: after.collections.length });
}
