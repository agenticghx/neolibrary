import { agentBooks } from "@/lib/agent/library";
import { withAgent } from "@/lib/agent/http";
import { agentUser } from "@/lib/auth/agent";
import { getDb } from "@/lib/db";
import { cappedFormData } from "@/lib/http-body";
import { ImportError, MAX_BOOK_REQUEST_BYTES } from "@/lib/library/ebook";
import { importBook } from "@/lib/library/import";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** The reader's books (M11 agent API). `?q=` filters by title or author. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  return withAgent(req, async ({ db, user }) => ({ books: await agentBooks(db, user.id, q) }));
}

/**
 * Adds one book file to the reader's library (M29), as the Import page does: multipart field "file" (an EPUB, a PDF
 * or a Markdown .md), and "attachTo" for a title waiting for its file. For scripts with the reader's token, such as
 * sending a Markdown book made on the laptop. Answers 201 with what happened (added, attached, duplicate, restored).
 */
export async function POST(req: Request) {
  const who = await agentUser(req);
  if (who instanceof Response) return who;
  const form = await cappedFormData(req, MAX_BOOK_REQUEST_BYTES);
  if (form instanceof Response) return form;
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Send the book as the multipart field \"file\"." }, { status: 400 });
  const attachTo = typeof form.get("attachTo") === "string" ? (form.get("attachTo") as string) : null;
  try {
    const result = await importBook(await getDb(), await getStorage(), who.user.id, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, { attachTo });
    return Response.json(result, { status: result.status === "duplicate" ? 200 : 201 });
  } catch (e) {
    if (e instanceof ImportError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
