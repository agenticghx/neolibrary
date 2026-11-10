import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { clearPaper, PaperError, setPaper } from "@/lib/library/papers";
import { getPaperLookup } from "@/lib/papers";
import { setPaperSharing } from "@/lib/library/shared-papers";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

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

/** M41 R3c: { share: true | false } shares the owner's paper with invited readers, or stops sharing it. Admin only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Only the library's owner shares papers." }, { status: 403 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { share?: unknown };
  if (typeof body.share !== "boolean") return Response.json({ error: "Say share: true or false." }, { status: 400 });
  try {
    return Response.json(await setPaperSharing(await getDb(), user.id, bookId, body.share));
  } catch (e) {
    if (e instanceof Error && e.message === "Book not found") return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
