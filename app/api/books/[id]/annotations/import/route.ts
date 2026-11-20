import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { jsonAtMost } from "@/lib/http-body";
import { FormatError, fromW3C } from "@/lib/library/annotation-formats";
import { AnnotationError, importAnnotations } from "@/lib/library/annotations";
import { MAX_IMPORT_BYTES } from "@/lib/library/export";
import { getBook } from "@/lib/library/paths";

export const dynamic = "force-dynamic";

/** Adds W3C Web Annotation JSON to a book. Existing annotations are never overwritten. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const db = await getDb();
  const bookId = (await params).id;
  if (!(await getBook(db, user.id, bookId))) return Response.json({ error: "Not found" }, { status: 404 });
  const raw = await jsonAtMost(req, MAX_IMPORT_BYTES);
  if (raw instanceof Response) return raw;
  try {
    const items = fromW3C(raw);
    return Response.json(await importAnnotations(db, user.id, bookId, items));
  } catch (e) {
    if (e instanceof FormatError || e instanceof AnnotationError || e instanceof SyntaxError) {
      return Response.json({ error: e instanceof SyntaxError ? "That file is not valid JSON." : e.message }, { status: 400 });
    }
    throw e;
  }
}
