import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { clearPaper, PaperError, setPaper } from "@/lib/library/papers";
import { getPaperLookup } from "@/lib/papers";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/** M41 R3: { id: "<DOI or PubMed ID>" } makes the title that paper, with its details from Crossref or PubMed. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  try {
    return Response.json(await setPaper(await getDb(), getPaperLookup(), user.id, bookId, body.id));
  } catch (e) {
    if (e instanceof PaperError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** The title is a book again. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  try {
    return Response.json(await clearPaper(await getDb(), user.id, bookId));
  } catch (e) {
    if (e instanceof PaperError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
