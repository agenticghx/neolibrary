import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getStyles, setStyle, StyleError } from "@/lib/library/ai-style";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/** The style for AI explanations: { user, book, effective }. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  try {
    return Response.json(await getStyles(await getDb(), user.id, bookId));
  } catch (e) {
    if (e instanceof StyleError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

/** { scope: "all", style } sets the reader's style; { scope: "book", style | null } sets (or clears) this book's. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    return Response.json(await setStyle(await getDb(), user.id, bookId, body));
  } catch (e) {
    if (e instanceof StyleError) return Response.json({ error: e.message }, { status: e.message === "Book not found" ? 404 : 400 });
    throw e;
  }
}
