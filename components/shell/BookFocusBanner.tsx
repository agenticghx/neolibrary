"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import styles from "./BookFocusBanner.module.css";

/** "7 November", in the reader's own time zone (the server does not know it, so the date is put in after loading). */
function untilDay(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone });
}

const noChange = () => () => {};

/**
 * Whole-book focus (M26 R5): one line at the top of every app page that still opens while it runs (Review, Stats,
 * Paths, Import, Account...), naming the book and how long the focus lasts, with the way back to it. Leaving early
 * is in the reader, beside the book.
 */
export function BookFocusBanner({ bookId, homeId, title, endsAt }: { bookId: string; homeId: string; title: string; endsAt: string }) {
  // The server draws the day in UTC; the browser, in its own time zone.
  const day = useSyncExternalStore(
    noChange,
    () => untilDay(endsAt),
    () => untilDay(endsAt, "UTC"),
  );
  return (
    <aside className={styles.banner} aria-label="Whole-book focus" data-testid="book-focus-banner">
      <p className={styles.text}>
        Focusing on{" "}
        <Link href={`/books/${homeId}`} className={styles.title}>
          {title}
        </Link>{" "}
        until {day}. Other books open again when it ends.
      </p>
      <Link href={`/books/${bookId}/read`} className={styles.open}>
        Read it
      </Link>
    </aside>
  );
}
