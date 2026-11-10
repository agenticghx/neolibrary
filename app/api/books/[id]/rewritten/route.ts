import { SpendingCapReached } from "@/lib/ai/generate";
import { aiIsFake } from "@/lib/ai/index";
import { savedOrNewModelFor, textModelFor } from "@/lib/ai/model-picks";
import { AiError, AiNotConfigured, AiRefused, type TextModel } from "@/lib/ai/model";
import { askerOr } from "@/lib/auth/asker";
import { getDb } from "@/lib/db";
import { StyleError } from "@/lib/library/ai-style";
import { isCfi } from "@/lib/library/reading";
import { RewriteError } from "@/lib/library/rewrite";
import { rewriteInStyle, rewrittenView } from "@/lib/library/rewritten";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function aiErrorResponse(e: unknown) {
  if (e instanceof StyleError) return Response.json({ error: e.message }, { status: 404 });
  if (e instanceof RewriteError) return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof SpendingCapReached) return Response.json({ error: e.message }, { status: 429 });
  if (e instanceof AiNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof AiRefused) return Response.json({ error: e.message }, { status: 422 });
  if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

/**
 * Read it rewritten (M17): the paragraphs on screen, from `?from=` to `?to=`
 * (CFIs; `to` defaults to `from`), each with its rewrite in the book's style,
 * or what one would cost: { style, pieces, fake }.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  // M34: a visitor, for a free book only, within their request limit (lib/auth/asker.ts).
  const user = await askerOr(await getDb(), bookId, req);
  if (user instanceof Response) return user;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to") ?? from;
  if (!isCfi(from) || !isCfi(to)) return Response.json({ error: "Give the place on screen (from and to)." }, { status: 400 });
  let model: TextModel | null = null;
  try {
    model = await textModelFor(await getDb(), "rewrite", user, req);
  } catch (e) {
    if (!(e instanceof AiNotConfigured)) throw e;
  }
  try {
    const view = await rewrittenView(await getDb(), model, user.id, bookId, { from, to });
    return Response.json({ ...view, fake: aiIsFake() });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

/** Rewrites one paragraph in the book's style, or re-serves the stored one: { sectionId, fresh? }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  // M34: a visitor, for a free book only, within their request limit (lib/auth/asker.ts).
  const user = await askerOr(await getDb(), bookId, req);
  if (user instanceof Response) return user;
  const body = (await req.json().catch(() => ({}))) as { sectionId?: unknown; fresh?: unknown };
  if (typeof body.sectionId !== "string") return Response.json({ error: "Choose a paragraph." }, { status: 400 });
  try {
    const out = await rewriteInStyle(await getDb(), await savedOrNewModelFor(await getDb(), "rewrite", user, req), user.id, { bookId, sectionId: body.sectionId, fresh: body.fresh === true && !user.visitor });
    return Response.json(out, { status: out.reused ? 200 : 201 });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
