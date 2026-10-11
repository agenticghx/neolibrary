import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { reviewQueue } from "@/lib/library/review";
import { ReviewSession } from "./ReviewSession";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Review" };
export const dynamic = "force-dynamic";

/**
 * Daily review (M21): today's cards (the reader's highlights and notes) one at a time, each
 * rated Again, Hard, Good or Easy, which sets when it comes back (lib/library/review-schedule.ts).
 */
export default async function ReviewPage() {
  const user = await requireUser();
  const queue = await reviewQueue(await getDb(), user.id);
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Daily review</p>
      <h1 className={styles.title}>Review</h1>
      <ReviewSession cards={queue.cards} nextDueAt={queue.nextDueAt} total={queue.total} />
    </main>
  );
}
