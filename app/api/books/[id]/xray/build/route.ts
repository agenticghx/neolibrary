import { SpendingCapReached } from "@/lib/ai/generate";
import { aiIsFake, getTextModel } from "@/lib/ai/index";
import { AiError, AiNotConfigured } from "@/lib/ai/model";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { XrayError } from "@/lib/library/xray";
import { startXray, stopXray, xraySummary } from "@/lib/library/xray-read";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

function errorResponse(e: unknown) {
  if (e instanceof XrayError) return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof SpendingCapReached) return Response.json({ error: e.message }, { status: 429 });
  if (e instanceof AiNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

/**
 * Reading the whole book with Claude for X-ray (M32 X3). GET: how much is
 * read, what the rest would cost at most, the caps, and whether a run is
 * going on. POST { confirm: true }: start (or carry on). DELETE: stop.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const db = await getDb();
  try {
    let model;
    try {
      model = getTextModel("xray");
    } catch (e) {
      if (e instanceof AiNotConfigured) return Response.json({ configured: false });
      throw e;
    }
    return Response.json({ configured: true, fake: aiIsFake(), ...(await xraySummary(db, model, user.id, bookId)) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
  const db = await getDb();
  try {
    const model = getTextModel("xray");
    const { started } = await startXray({ db, model }, user.id, bookId, body.confirm);
    return Response.json({ started, ...(await xraySummary(db, model, user.id, bookId)) }, { status: started ? 202 : 200 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  return Response.json({ stopping: stopXray(user.id, bookId) });
}
