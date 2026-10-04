import { SpendingCapReached } from "@/lib/ai/generate";
import { aiIsFake, getTextModel } from "@/lib/ai/index";
import { AiError, AiNotConfigured, AiRefused } from "@/lib/ai/model";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isCfi } from "@/lib/library/reading";
import {
  estimateRewrite,
  isLevel,
  LEVELS,
  listRewrites,
  paragraphFor,
  rewriteParagraph,
  RewriteError,
  STRICTNESS,
  strictnessFrom,
  viewRewrite,
} from "@/lib/library/rewrite";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

function aiErrorResponse(e: unknown) {
  if (e instanceof RewriteError) return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof SpendingCapReached) return Response.json({ error: e.message }, { status: 429 });
  if (e instanceof AiNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof AiRefused) return Response.json({ error: e.message }, { status: 422 });
  if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

/**
 * The paragraph at a place in the book (`?cfi=`) or by id (`?section=`), its
 * stored rewrites (oldest first) and what a new rewrite would cost, per level.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const url = new URL(req.url);
  const cfi = url.searchParams.get("cfi");
  const sectionId = url.searchParams.get("section");
  const db = await getDb();
  try {
    const paragraph = await paragraphFor(db, user.id, bookId, cfi && isCfi(cfi) ? { cfi } : { sectionId: sectionId ?? "" });
    const versions = await listRewrites(db, user.id, bookId, paragraph.id);
    let estimates: Record<string, number> | null = null;
    try {
      const model = getTextModel();
      estimates = {};
      for (const level of Object.keys(LEVELS)) {
        if (isLevel(level)) estimates[level] = await estimateRewrite(db, model, user.id, bookId, paragraph.id, level);
      }
    } catch (e) {
      if (!(e instanceof AiNotConfigured)) throw e;
    }
    return Response.json({ paragraph, versions, estimates, levels: LEVELS, strictness: STRICTNESS, fake: aiIsFake() });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

/**
 * Rewrites a paragraph, or re-serves the stored rewrite: { sectionId, level,
 * strictness?, fresh? }. For STE, strictness is light, standard (the default),
 * strict, or a percentage.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { sectionId?: unknown; level?: unknown; strictness?: unknown; fresh?: unknown };
  if (typeof body.sectionId !== "string" || !isLevel(body.level)) {
    return Response.json({ error: "Choose a paragraph and a level." }, { status: 400 });
  }
  const strictness = body.strictness === undefined ? "standard" : strictnessFrom(body.strictness);
  if (!strictness) return Response.json({ error: "STE strictness is Light, Standard, Strict or a percentage." }, { status: 400 });
  try {
    const out = await rewriteParagraph(await getDb(), getTextModel(), user.id, {
      bookId,
      sectionId: body.sectionId,
      level: body.level,
      strictness,
      fresh: body.fresh === true,
    });
    return Response.json({ ...out, generation: viewRewrite(out.generation) }, { status: out.reused ? 200 : 201 });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
