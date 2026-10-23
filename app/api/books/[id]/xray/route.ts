import { aiIsFake } from "@/lib/ai/index";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isCfi } from "@/lib/library/reading";
import { buildXray, listXray, XrayError } from "@/lib/library/xray";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * Who & what (M32 X1): the book's X-ray index, with each entry's trail of
 * chapters and how much of it the reader has reached (`?cfi=` is where they
 * are; without it, the start of the book). Built from the text on first use.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const cfi = new URL(req.url).searchParams.get("cfi") ?? "";
  if (cfi && !isCfi(cfi)) return Response.json({ error: "That is not a place in the book." }, { status: 400 });
  try {
    return Response.json({ ...(await listXray(await getDb(), user.id, bookId, cfi || null)), fake: aiIsFake() });
  } catch (e) {
    if (e instanceof XrayError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

/** Reads the book's text again and rebuilds the index from it. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const db = await getDb();
  try {
    // listXray checks the book is the reader's own before anything is touched.
    await listXray(db, user.id, bookId, null);
    return Response.json(await buildXray(db, bookId));
  } catch (e) {
    if (e instanceof XrayError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
