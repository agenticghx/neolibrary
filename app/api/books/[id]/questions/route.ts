import { SpendingCapReached } from "@/lib/ai/generate";
import { aiIsFake, getTextModel } from "@/lib/ai/index";
import { AiError, AiNotConfigured, AiRefused } from "@/lib/ai/model";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getStyles } from "@/lib/library/ai-style";
import { chapterFor, PrerequisitesError } from "@/lib/library/prerequisites";
import { estimateQuestionBank, listQuestionBanks, marksFor, questionBank } from "@/lib/library/questions";
import { isCfi } from "@/lib/library/reading";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

function errorResponse(e: unknown) {
  if (e instanceof PrerequisitesError) return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof SpendingCapReached) return Response.json({ error: e.message }, { status: 429 });
  if (e instanceof AiNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof AiRefused) return Response.json({ error: e.message }, { status: 422 });
  if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

/** The chapter at `?cfi=`, its stored question banks (oldest first), the reader's marks and the cost of asking. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const cfi = new URL(req.url).searchParams.get("cfi") ?? "";
  if (!isCfi(cfi)) return Response.json({ error: "Open a chapter first." }, { status: 400 });
  const db = await getDb();
  try {
    const chapter = await chapterFor(db, user.id, bookId, { cfi });
    const versions = await listQuestionBanks(db, user.id, bookId, chapter.id);
    const marks = await marksFor(db, user.id, bookId);
    const { effective: style } = await getStyles(db, user.id, bookId);
    let estimate: number | null = null;
    try {
      estimate = await estimateQuestionBank(db, getTextModel(), user.id, bookId, chapter);
    } catch (e) {
      if (!(e instanceof AiNotConfigured)) throw e;
    }
    return Response.json({ chapter, versions, marks, style, estimate, fake: aiIsFake() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Makes (or re-serves) the chapter's question bank: { chapterId, fresh? }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { chapterId?: unknown; fresh?: unknown };
  if (typeof body.chapterId !== "string") return Response.json({ error: "Choose a chapter." }, { status: 400 });
  try {
    const out = await questionBank(await getDb(), getTextModel(), user.id, { bookId, chapterId: body.chapterId, fresh: body.fresh === true });
    return Response.json(out, { status: out.reused ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
