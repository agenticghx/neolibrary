import { SpendingCapReached } from "@/lib/ai/generate";
import { aiIsFake } from "@/lib/ai/index";
import { savedOrNewModelFor, textModelFor } from "@/lib/ai/model-picks";
import { AiError, AiNotConfigured, AiRefused } from "@/lib/ai/model";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { estimateSummary, listSummaries, PaperSummaryError, summariseCard } from "@/lib/library/paper-summary";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function errorResponse(e: unknown) {
  if (e instanceof PaperSummaryError) return Response.json({ error: e.message }, { status: e.message === "Book not found" ? 404 : 400 });
  if (e instanceof SpendingCapReached) return Response.json({ error: e.message }, { status: 429 });
  if (e instanceof AiNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof AiRefused) return Response.json({ error: e.message }, { status: 422 });
  if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

/** M41 R4a: a paper's stored summary cards (oldest first) and the cost of making one. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const db = await getDb();
  try {
    const versions = await listSummaries(db, user.id, bookId);
    let estimate: number | null = null;
    try {
      estimate = await estimateSummary(db, await textModelFor(db, "paper-summary", user, req), user.id, bookId);
    } catch (e) {
      if (!(e instanceof AiNotConfigured)) throw e;
    }
    return Response.json({ versions, estimate, fake: aiIsFake() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Makes the card (or re-serves the stored one): { fresh? }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = ((await req.json().catch(() => null)) ?? {}) as { fresh?: unknown };
  const db = await getDb();
  try {
    const out = await summariseCard(db, await savedOrNewModelFor(db, "paper-summary", user, req), user.id, { bookId, fresh: body.fresh === true });
    return Response.json(out, { status: out.reused ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
