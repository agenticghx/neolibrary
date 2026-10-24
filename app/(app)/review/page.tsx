import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { focusedBookIds } from "@/lib/library/focus-lock";
import { NEW_PER_DAY, questionDelayDays, reviewQueue } from "@/lib/library/review";
import { ReviewSession } from "./ReviewSession";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Review" };
export const dynamic = "force-dynamic";

/**
 * Daily review (M21): today's cards (the reader's highlights and notes) one at a time, each
 * rated Again, Hard, Good or Easy, which sets when it comes back (lib/library/review-schedule.ts). During a
 * whole-book focus (M26 R5), only that book's cards.
 */
export default async function ReviewPage() {
  const user = await requireUser();
  const db = await getDb();
  const queue = await reviewQueue(db, user.id, new Date(), NEW_PER_DAY, questionDelayDays(), await focusedBookIds(db, user.id));
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Daily review</p>
      <h1 className={styles.title}>Review</h1>
      <ReviewSession cards={queue.cards} nextDueAt={queue.nextDueAt} total={queue.total} />
    </main>
  );
}
