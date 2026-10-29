import { SpendingCapReached } from "@/lib/ai/generate";
import { aiIsFake } from "@/lib/ai/index";
import { textModel } from "@/lib/ai/model-picks";
import { AiError, AiNotConfigured, AiRefused } from "@/lib/ai/model";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { askBook, AskError, AskNotFound, assertOwnBook, estimateAsk, latestAsk } from "@/lib/library/ask";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

function errorResponse(e: unknown) {
  if (e instanceof AskNotFound) return Response.json({ error: e.message }, { status: 404 });
  if (e instanceof AskError) return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof SpendingCapReached) return Response.json({ error: e.message }, { status: 429 });
  if (e instanceof AiNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof AiRefused) return Response.json({ error: e.message }, { status: 422 });
  if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

/** Ask this book (M21): the most a question costs (null when AI is not set up), and the reader's latest answer. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found." }, { status: 404 });
  const db = await getDb();
  try {
    await assertOwnBook(db, user.id, bookId);
    let estimate: number | null = null;
    try {
      estimate = await estimateAsk(db, await textModel(db, "ask"), bookId);
    } catch (e) {
      if (!(e instanceof AiNotConfigured)) throw e;
    }
    return Response.json({ estimate, latest: await latestAsk(db, user.id, bookId), fake: aiIsFake() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Answers { question } from this book's own paragraphs, with citations; the owner only. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { question?: unknown };
  try {
    const out = await askBook(await getDb(), await textModel(await getDb(), "ask"), user.id, { bookId, question: body.question });
    return Response.json(out, { status: out.found && !out.reused ? 201 : 200 });
  } catch (e) {
    return errorResponse(e);
  }
}
