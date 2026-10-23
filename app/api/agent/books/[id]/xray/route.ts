import { agentUser } from "@/lib/auth/agent";
import { getDb } from "@/lib/db";
import { jsonAtMost } from "@/lib/http-body";
import { XrayError } from "@/lib/library/xray";
import { nextChapterToRead, saveChapterReadElsewhere, type ReadElsewhere } from "@/lib/library/xray-read";

export const dynamic = "force-dynamic";

const MAX_BODY = 2 * 1024 * 1024;
const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * X-ray read on the owner's own Claude subscription (M32 X5), with an API
 * token: scripts/xray-on-subscription.ts. GET: the next chapter not yet read,
 * with the exact request the server would send (`chapter` is null when every
 * chapter is read). POST: one chapter's answer, stored as the server's own
 * and checked like one.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await agentUser(_req);
  if (who instanceof Response) return who;
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  try {
    return Response.json(await nextChapterToRead(await getDb(), who.user.id, bookId));
  } catch (e) {
    if (e instanceof XrayError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await agentUser(req);
  if (who instanceof Response) return who;
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = await jsonAtMost(req, MAX_BODY);
  if (body instanceof Response) return body;
  try {
    return Response.json(await saveChapterReadElsewhere(await getDb(), who.user.id, bookId, (body ?? {}) as ReadElsewhere), { status: 201 });
  } catch (e) {
    if (e instanceof XrayError) return Response.json({ error: e.message }, { status: e.message.includes("not found") ? 404 : 400 });
    throw e;
  }
}
