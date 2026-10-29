import { SpendingCapReached } from "@/lib/ai/generate";
import { aiIsFake, getTextModel } from "@/lib/ai/index";
import { getModelPicks, textModel } from "@/lib/ai/model-picks";
import { AiError, AiNotConfigured, AiRefused } from "@/lib/ai/model";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getStyles } from "@/lib/library/ai-style";
import { estimateExplainBack, ExplainBackError, explainBack, listAttempts, partAnchor } from "@/lib/library/explain-back";
import { chapterFor, PrerequisitesError } from "@/lib/library/prerequisites";
import { isCfi } from "@/lib/library/reading";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/** An error as a response: its message for the reader, and the status that fits it. */
function failure(e: unknown): { status: number; error: string } {
  if (e instanceof ExplainBackError || e instanceof PrerequisitesError) return { status: 400, error: e.message };
  if (e instanceof SpendingCapReached) return { status: 429, error: e.message };
  if (e instanceof AiNotConfigured) return { status: 503, error: e.message };
  if (e instanceof AiRefused) return { status: 422, error: e.message };
  if (e instanceof AiError) return { status: 502, error: e.message };
  throw e;
}

const errorResponse = (e: unknown) => {
  const f = failure(e);
  return Response.json({ error: f.error }, { status: f.status });
};

/**
 * Explain it back (M26 R1), for the part of the book at `?cfi=`: the part, where a summary of it is anchored, what
 * checking one costs at most, and the reader's earlier attempts (newest first). No answer is shown without a summary.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const cfi = new URL(req.url).searchParams.get("cfi") ?? "";
  if (!isCfi(cfi)) return Response.json({ error: "Open a part of the book first." }, { status: 400 });
  const db = await getDb();
  try {
    const chapter = await chapterFor(db, user.id, bookId, { cfi });
    const attempts = await listAttempts(db, user.id, bookId, chapter);
    const { effective: style } = await getStyles(db, user.id, bookId);
    const anchor = await partAnchor(db, bookId, chapter);
    let estimate: number | null = null;
    try {
      estimate = await estimateExplainBack(db, await textModel(db, "explain-back"), user.id, bookId, chapter);
    } catch (e) {
      if (!(e instanceof AiNotConfigured)) throw e;
    }
    return Response.json({ chapter, anchor, attempts, style, estimate, fake: aiIsFake() });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Saves { summary } of { chapterId } as the reader's note, then asks Claude what it missed. When the call cannot be
 * made (a spending cap, no AI set up), the note is saved all the same: the answer is null and `error` says why.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { chapterId?: unknown; summary?: unknown };
  try {
    const db = await getDb();
    const picks = await getModelPicks(db);
    const out = await explainBack(db, () => getTextModel("explain-back", process.env, picks), user.id, { bookId, chapterId: body.chapterId, summary: body.summary });
    if (out.error) {
      const f = failure(out.error);
      return Response.json({ note: out.note, attempt: null, reused: false, error: f.error }, { status: f.status });
    }
    return Response.json({ note: out.note, attempt: out.attempt, reused: out.reused, error: null }, { status: out.reused ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
