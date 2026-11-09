import { SpendingCapReached } from "@/lib/ai/generate";
import { aiIsFake } from "@/lib/ai/index";
import { savedOrNewModelFor, textModelFor } from "@/lib/ai/model-picks";
import { AiError, AiNotConfigured, AiRefused } from "@/lib/ai/model";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getStyles } from "@/lib/library/ai-style";
import { equationAt, estimateExplainMath, explainMath, ExplainMathError, listExplainMath } from "@/lib/library/explain-math";
import { isCfi } from "@/lib/library/reading";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

function errorResponse(e: unknown) {
  if (e instanceof ExplainMathError) return Response.json({ error: e.message }, { status: e.message === "Book not found" ? 404 : 400 });
  if (e instanceof SpendingCapReached) return Response.json({ error: e.message }, { status: 429 });
  if (e instanceof AiNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof AiRefused) return Response.json({ error: e.message }, { status: 422 });
  if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

/** M41 R4b: the equation at `cfi` (its LaTeX in POST's body), its stored explanations and the cost of asking. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { cfi?: unknown; latex?: unknown; ask?: unknown; fresh?: unknown };
  if (typeof body.cfi !== "string" || !isCfi(body.cfi)) return Response.json({ error: "Tap an equation first." }, { status: 400 });
  const db = await getDb();
  try {
    // { cfi, latex }: what is stored and what asking costs. { cfi, latex, ask: true, fresh? }: ask (or re-serve).
    if (body.ask === true) {
      const out = await explainMath(db, await savedOrNewModelFor(db, "explain-math", user, req), user.id, { bookId, cfi: body.cfi, latex: body.latex, fresh: body.fresh === true });
      return Response.json(out, { status: out.reused ? 200 : 201 });
    }
    const equation = await equationAt(db, user.id, bookId, body.cfi, body.latex);
    const versions = await listExplainMath(db, user.id, bookId, equation);
    let estimate: number | null = null;
    try {
      estimate = await estimateExplainMath(db, await textModelFor(db, "explain-math", user, req), user.id, bookId, equation);
    } catch (e) {
      if (!(e instanceof AiNotConfigured)) throw e;
    }
    const { effective: style } = await getStyles(db, user.id, bookId);
    return Response.json({ equation, versions, style, estimate, fake: aiIsFake() });
  } catch (e) {
    return errorResponse(e);
  }
}
