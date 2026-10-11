import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { searchLibrary } from "@/lib/library/search";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIND_LIMIT = 60;

/** Find in this book (M20 Q5): ?q= searched in this book only, hits in reading order, at most 60. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!UUID.test(bookId)) return Response.json({ error: "Book not found." }, { status: 404 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ hits: await searchLibrary(await getDb(), user.id, q, FIND_LIMIT, bookId) });
}
