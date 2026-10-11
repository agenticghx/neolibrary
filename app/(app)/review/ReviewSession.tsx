"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewCard } from "@/lib/library/review";
import { formatDay, RATINGS, whenLabel, type Rating } from "@/lib/library/review-schedule";
import styles from "./page.module.css";

const LABELS: Record<Rating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

type Props = { cards: ReviewCard[]; nextDueAt: string | null; total: number };

/**
 * One card at a time (M21): the passage with its book and chapter; the reader's note stays hidden
 * until Show (or Space); then Again, Hard, Good or Easy (or keys 1 to 4). Again puts the card at the
 * end of today's cards. Each rating is saved before the next card shows.
 */
export function ReviewSession({ cards, nextDueAt, total }: Props) {
  const router = useRouter();
  const [queue, setQueue] = useState(cards);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const [next, setNext] = useState(nextDueAt);
  const busy = useRef(false);
  const cardRef = useRef<HTMLElement>(null);
  const moved = useRef(false);
  const card = queue[index];

  // After Show or a rating, keyboard focus goes to the card (not a button: a second Space must not rate it).
  useEffect(() => {
    if (moved.current) cardRef.current?.focus();
  }, [index, revealed]);

  const reveal = useCallback(() => {
    moved.current = true;
    setRevealed(true);
  }, []);

  const rate = useCallback(
    async (rating: Rating) => {
      if (!card || busy.current) return;
      busy.current = true;
      setError("");
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ annotationId: card.id, rating }),
      }).catch(() => null);
      busy.current = false;
      if (!res?.ok) {
        setError("That rating was not saved. Check the connection and rate it again.");
        return;
      }
      const data = (await res.json()) as { nextDueAt: string | null };
      setNext(data.nextDueAt);
      // Again: once more at the end of today's cards, as a card learned from the start.
      if (rating === "again") setQueue((q) => [...q, { ...card, isNew: false, next: { again: 0, hard: 1, good: 1, easy: 4 } }]);
      moved.current = true;
      setIndex((i) => i + 1);
      setRevealed(false);
      router.refresh(); // the sidebar's count
    },
    [card, router],
  );

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === " ") {
        if (target?.closest("button")) return; // a focused button presses itself
        e.preventDefault(); // no scrolling
        if (!revealed) reveal();
      } else if (revealed && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        void rate(RATINGS[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, revealed, reveal, rate]);

  if (!card) {
    return (
      <section className={styles.empty} aria-labelledby="review-empty" data-testid="review-empty">
        <h2 id="review-empty" className={styles.emptyTitle}>
          {total === 0 ? "Nothing to review yet." : "Nothing to review today."}
        </h2>
        {next ? (
          <p className={styles.emptyText}>Next card: {formatDay(next)}.</p>
        ) : (
          <p className={styles.emptyText}>Highlight a passage or write a note while you read, and it comes back here on a schedule that helps you remember it.</p>
        )}
        <Link href="/" className={styles.quiet}>
          Back to Home
        </Link>
      </section>
    );
  }

  const where = card.on === "passage" && card.cfi ? `/books/${card.bookId}/read?at=${encodeURIComponent(card.cfi)}` : `/books/${card.bookId}`;
  return (
    <div className={styles.session}>
      <p className={styles.progress} aria-live="polite" data-testid="review-progress">
        {index + 1} of {queue.length}
        {card.isNew ? <span className={styles.badge}>New</span> : null}
      </p>
      <article ref={cardRef} tabIndex={-1} className={styles.card} aria-label={`Card ${index + 1} of ${queue.length}`} data-testid="review-card">
        <p className={styles.source}>
          {card.bookTitle}
          {card.chapter ? <span className={styles.chapter}> · {card.chapter}</span> : null}
        </p>
        {card.on === "passage" ? (
          <blockquote className={styles.quote}>{card.quote}</blockquote>
        ) : (
          <p className={styles.bookWide}>Your note on the whole book. What did you write?</p>
        )}
        {revealed ? (
          <div className={styles.answer} data-testid="review-answer">
            <p className={styles.answerLabel}>Your note</p>
            {card.note ? <p className={styles.note}>{card.note}</p> : <p className={styles.noNote}>No note: you highlighted this passage.</p>}
          </div>
        ) : null}
        <Link href={where} className={styles.go}>
          {card.on === "passage" ? "Go to passage" : "Open the book"}
        </Link>
      </article>
      {revealed ? (
        <div role="group" aria-label="How well did you remember it?" className={styles.ratings}>
          {RATINGS.map((r, i) => (
            <button key={r} type="button" className={r === "good" ? styles.ratePrimary : styles.rate} onClick={() => void rate(r)} aria-keyshortcuts={String(i + 1)}>
              <span className={styles.rateName}>{LABELS[r]}</span>
              <span className={styles.rateWhen}>{whenLabel(card.next[r])}</span>
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className={styles.show} onClick={reveal} aria-keyshortcuts="Space">
          Show
        </button>
      )}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <p className={styles.hint}>Keys: Space shows your note; 1 Again, 2 Hard, 3 Good, 4 Easy.</p>
    </div>
  );
}
