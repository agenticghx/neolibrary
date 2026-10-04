import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ExportFormatError, exportLibrary, importLibrary } from "@/lib/library/export";

export const dynamic = "force-dynamic";

/**
 * Brings back a library export into an empty library. Refuses to import over
 * existing data, so nothing is silently merged or overwritten (ground rule 9).
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const db = await getDb();
  const current = await exportLibrary(db, user.id);
  if (current.books.length || current.paths.length || current.collections.length || current.annotations?.length) {
    return Response.json({ error: "Your library is not empty. Importing only works into an empty library." }, { status: 409 });
  }
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return Response.json({ error: "That file is not valid JSON." }, { status: 400 });
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
