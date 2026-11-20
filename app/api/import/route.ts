import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { jsonAtMost } from "@/lib/http-body";
import { ExportFormatError, importLibrary, isLibraryEmpty, MAX_IMPORT_BYTES } from "@/lib/library/export";

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
  if (!(await isLibraryEmpty(db, user.id))) {
    return Response.json({ error: "Your library is not empty. Importing only works into an empty library." }, { status: 409 });
  }
  try {
    const counts = await importLibrary(db, user.id, data);
    return Response.json(counts);
  } catch (e) {
    if (e instanceof ExportFormatError) return Response.json({ error: e.message }, { status: 400 });
    console.error("Import failed", e);
    return Response.json({ error: "The import failed and nothing was changed." }, { status: 400 });
  }
}
