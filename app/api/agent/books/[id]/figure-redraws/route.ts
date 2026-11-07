import { agentUser } from "@/lib/auth/agent";
import { getDb } from "@/lib/db";
import { jsonAtMost } from "@/lib/http-body";
import { FigureRedrawError, saveFigureRedraws } from "@/lib/library/figure-redraws";
import { mayMakeTextEditions, OWNER_ONLY } from "@/lib/library/text-edition";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** A part of redraws: the laptop script sends at most about 3 MB of drawings at a time. */
const MAX_BODY = 4 * 1024 * 1024;
const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * M41 R6: a paper's figures redrawn and checked on the owner's own Claude subscription
 * (scripts/figures-on-subscription.ts), sent with the owner's API token: `{ figures: [...] }`. Each is checked
 * against the book's own file before it is stored (lib/library/figure-redraws.ts). Library owner only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await agentUser(req);
  if (who instanceof Response) return who;
  if (!mayMakeTextEditions(who.user)) return Response.json({ error: OWNER_ONLY }, { status: 403 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found." }, { status: 404 });
  const body = await jsonAtMost(req, MAX_BODY);
  if (body instanceof Response) return body;
  try {
    return Response.json(await saveFigureRedraws({ db: await getDb(), storage: await getStorage() }, who.user.id, bookId, (body ?? {}) as Record<string, unknown>));
  } catch (e) {
    if (e instanceof FigureRedrawError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
