import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { focusedBookIds } from "@/lib/library/focus-lock";
import { NEW_PER_DAY, questionDelayDays, rateCard, reviewQueue, ReviewError } from "@/lib/library/review";

export const dynamic = "force-dynamic";

/**
 * Daily review (M21): rates one card, { cardId, rating } with rating one of
 * again, hard, good, easy (`annotationId` in place of `cardId` still works for a highlight or note). Answers with the card's new date, how many cards are
 * still waiting today, and when the next one comes due after those.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const db = await getDb();
  try {
    const now = new Date();
    const s = await rateCard(db, user.id, body?.cardId ?? body?.annotationId, body?.rating, now);
    // During a whole-book focus (M26 R5), only that book's cards count.
    const queue = await reviewQueue(db, user.id, now, NEW_PER_DAY, questionDelayDays(), await focusedBookIds(db, user.id, now));
    return Response.json({ dueAt: s.dueAt.toISOString(), intervalDays: s.intervalDays, remaining: queue.cards.length, nextDueAt: queue.nextDueAt });
  } catch (e) {
    if (e instanceof ReviewError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
