import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { crossLinks } from "@/lib/library/crosslinks";

export const dynamic = "force-dynamic";

/** Highlights and notes in the reader's other books that share this page's ideas: takes { text }, returns { links }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(bookId)) return Response.json({ links: [] });
  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  if (typeof body.text !== "string") return Response.json({ error: "Send the page's text." }, { status: 400 });
  return Response.json({ links: await crossLinks(await getDb(), user.id, bookId, body.text) });
}
