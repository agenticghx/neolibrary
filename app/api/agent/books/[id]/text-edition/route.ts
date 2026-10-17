import { agentUser } from "@/lib/auth/agent";
import { getDb } from "@/lib/db";
import { jsonAtMost } from "@/lib/http-body";
import { mayMakeTextEditions, OWNER_ONLY, savePagesReadElsewhere, TextEditionError } from "@/lib/library/text-edition";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** A part of pages: about 200 KB of text from the script, with room to spare. */
const MAX_BODY = 4 * 1024 * 1024;
const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * Pages of a scanned PDF read on the owner's own Claude subscription
 * (scripts/text-edition-on-subscription.ts), sent with the owner's API token:
 * `{ pages: [...], blankPages: [...], finish: true|false }`. The last part
 * (`finish: true`) checks the pages against the scan and makes the text
 * edition, as a batch job does when it ends (M25). Library owner only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await agentUser(req);
  if (who instanceof Response) return who;
  if (!mayMakeTextEditions(who.user)) return Response.json({ error: OWNER_ONLY }, { status: 403 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = await jsonAtMost(req, MAX_BODY);
  if (body instanceof Response) return body;
  try {
    return Response.json(await savePagesReadElsewhere({ db: await getDb(), storage: await getStorage() }, who.user.id, bookId, (body ?? {}) as Record<string, unknown>));
  } catch (e) {
    if (e instanceof TextEditionError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
