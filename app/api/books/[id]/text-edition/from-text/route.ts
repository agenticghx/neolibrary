import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { makeTextEditionFromPdfText, mayMakeTextEditions, OWNER_ONLY, TextEditionError } from "@/lib/library/text-edition";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * M31: makes (or makes again) a PDF's flowing text edition from the PDF's own text: no AI, nothing spent. The
 * library's owner only, as for a scan's text edition. Answers { editionId, pages, read }.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!mayMakeTextEditions(user)) return Response.json({ error: OWNER_ONLY }, { status: 403 });
  const bookId = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  try {
    return Response.json(await makeTextEditionFromPdfText({ db: await getDb(), storage: await getStorage() }, user.id, bookId));
  } catch (e) {
    if (e instanceof TextEditionError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
