import { agentUser } from "@/lib/auth/agent";
import { getDb } from "@/lib/db";
import { jsonAtMost } from "@/lib/http-body";
import { GenealogyError, genealogyStatus, saveGenealogy, type GenealogySend } from "@/lib/library/genealogy-store";

export const dynamic = "force-dynamic";

/** A whole book's genealogy: Chip War's is about 0.5 MB, with room to spare. */
const MAX_BODY = 8 * 1024 * 1024;
const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * A book's genealogy read on the owner's own Claude subscription (M43 S2), with an API token:
 * scripts/genealogy-on-subscription.ts `send`. GET: what the book holds now (null when nothing). POST: the skill's
 * checked result, checked again here against this server's copy of the book and stored in place of the book's last.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await agentUser(req);
  if (who instanceof Response) return who;
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  try {
    return Response.json({ genealogy: await genealogyStatus(await getDb(), who.user.id, bookId) });
  } catch (e) {
    if (e instanceof GenealogyError) return Response.json({ error: e.message }, { status: 404 });
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
    const saved = await saveGenealogy(await getDb(), who.user.id, bookId, body as GenealogySend);
    return Response.json(saved, { status: saved.unchanged ? 200 : 201 });
  } catch (e) {
    if (e instanceof GenealogyError) return Response.json({ error: e.message }, { status: e.message.includes("not found") ? 404 : 400 });
    throw e;
  }
}
