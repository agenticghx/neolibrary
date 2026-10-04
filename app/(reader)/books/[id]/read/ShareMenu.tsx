"use client";

import { useState } from "react";
import { downloadBlob, quoteCard } from "@/lib/reader/quote-card";
import styles from "./reader.module.css";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "quote";

/** Share a passage: a link that opens the reader there (for signed-in readers), or an image card. */
export function ShareMenu({
  bookId,
  cfi,
  quote,
  title,
  author,
  themeEl,
}: {
  bookId: string;
  cfi: string;
  quote: string;
  title: string;
  author: string;
  themeEl: () => Element | null;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" className={styles.tool} onClick={() => setOpen(true)}>
        Share
      </button>
    );
  return (
    <span className={styles.shareMenu} role="group" aria-label="Share this passage">
      <button
        type="button"
        className={styles.tool}
        onClick={async () => {
          const link = `${location.origin}/books/${bookId}/read?at=${encodeURIComponent(cfi)}`;
          await navigator.clipboard?.writeText(link).catch(() => {});
          setDone("Link copied");
        }}
      >
        Copy link
      </button>
      <button
        type="button"
        className={styles.tool}
        onClick={async () => {
          const blob = await quoteCard(themeEl() ?? document.documentElement, quote, title, author);
          downloadBlob(blob, `${slug(title)}-quote.png`);
          setDone("Card saved");
        }}
      >
        Image card
      </button>
      {done ? (
        <span role="status" className={styles.shareDone}>
          {done}
        </span>
      ) : null}
    </span>
  );
}
