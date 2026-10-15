import { AiError, AiNotConfigured } from "@/lib/ai/model";
import { getBatchModel } from "@/lib/ai";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  mayMakeTextEditions,
  OWNER_ONLY,
  startTextEdition,
  stopTextEdition,
  TextEditionError,
  textEditionSummary,
  type TextEditionDeps,
} from "@/lib/library/text-edition";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * A scanned PDF's text edition (M25, docs/scan-to-text-plan.md), for the
 * library's owner only, for now. GET: what reading the book involves (pages,
 * the most it costs, the limits and what is spent, the latest job). POST
 * { confirm: true }: starts reading it in the background (refused without
 * confirm: true, or when the cost does not fit beside the limits: 402).
 * DELETE: stops it; pages not yet read are not charged. Another reader's
 * book, or none, is "not found" (404).
 *
 * Anyone but the library's owner gets 403 with OWNER_ONLY from GET and POST,
 * before any book is looked at. DELETE is never refused to the book's owner,
 * whatever their role (stopping only saves money), and answers 204 to anyone
 * but the library's owner.
 */
const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const ownerOnly = () => Response.json({ error: OWNER_ONLY }, { status: 403 });

function errorResponse(e: unknown) {
  if (e instanceof TextEditionError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof AiNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

async function signedIn(params: Promise<{ id: string }>) {
  const user = await currentUser();
  if (!user) return { error: Response.json({ error: "Sign in required" }, { status: 401 }) };
  const bookId = (await params).id;
  if (!isId(bookId)) return { error: Response.json({ error: "Book not found" }, { status: 404 }) };
  return { error: null, user, bookId };
}

async function deps(): Promise<TextEditionDeps> {
  return { db: await getDb(), storage: await getStorage(), model: getBatchModel() };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const at = await signedIn(params);
  if (at.error) return at.error;
  if (!mayMakeTextEditions(at.user)) return ownerOnly();
  try {
    return Response.json(await textEditionSummary(await deps(), at.user.id, at.bookId));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const at = await signedIn(params);
  if (at.error) return at.error;
  if (!mayMakeTextEditions(at.user)) return ownerOnly();
  const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
  try {
    const d = await deps();
    const { started } = await startTextEdition(d, at.user.id, at.bookId, body.confirm);
    // 202: started, going on in the background; 200: it was going on already.
    return Response.json(await textEditionSummary(d, at.user.id, at.bookId), { status: started ? 202 : 200 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const at = await signedIn(params);
  if (at.error) return at.error;
  try {
    const d = await deps();
    await stopTextEdition(d, at.user.id, at.bookId);
    if (!mayMakeTextEditions(at.user)) return new Response(null, { status: 204 });
    return Response.json(await textEditionSummary(d, at.user.id, at.bookId));
  } catch (e) {
    return errorResponse(e);
  }
}
