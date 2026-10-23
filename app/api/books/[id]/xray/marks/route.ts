import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { marksFor, XrayError } from "@/lib/library/xray";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * M32 X2: the X-ray marks of one chapter (`?chapter=` is the spine index foliate
 * gives the chapter; a PDF's page): the first mention of each name in each
 * paragraph, for the dotted underlines and the "On this page" strip.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const chapter = Number(new URL(req.url).searchParams.get("chapter"));
  if (!Number.isInteger(chapter) || chapter < 0) return Response.json({ error: "Which chapter?" }, { status: 400 });
  try {
    return Response.json({ marks: await marksFor(await getDb(), user.id, bookId, chapter) });
  } catch (e) {
    if (e instanceof XrayError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
