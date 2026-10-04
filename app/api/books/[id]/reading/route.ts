import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { recordReading, StatsError } from "@/lib/library/reading-stats";

export const dynamic = "force-dynamic";

/** The reader's running totals for a sitting: { sessionId, startedAt, activeSeconds, words, pages }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    await recordReading(await getDb(), user.id, {
      sessionId: body.sessionId,
      bookId: (await params).id,
      startedAt: body.startedAt,
      activeSeconds: body.activeSeconds,
      words: body.words,
      pages: body.pages,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof StatsError) return Response.json({ error: e.message }, { status: e.message === "Book not found" ? 404 : 400 });
    throw e;
  }
}
