import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isCfi } from "@/lib/library/reading";
import { GenealogyError } from "@/lib/library/genealogy-store";
import { genealogyView } from "@/lib/library/genealogy-view";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * Genealogy (M43 S3): the book's stored links and lives as the views draw them, with the reader's chapter
 * (`?cfi=` is where they are). `{ none: true }` when no genealogy has been sent for the book yet.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const cfi = new URL(req.url).searchParams.get("cfi") ?? "";
  if (cfi && !isCfi(cfi)) return Response.json({ error: "That is not a place in the book." }, { status: 400 });
  try {
    const view = await genealogyView(await getDb(), user.id, bookId, cfi || null);
    return Response.json(view ?? { none: true });
  } catch (e) {
    if (e instanceof GenealogyError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
