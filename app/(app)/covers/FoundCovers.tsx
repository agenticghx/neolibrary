"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./page.module.css";

export type FoundCover = { id: string; title: string; author: string; imageUrl: string; pageUrl: string | null; sourceName: string };

/** The found covers (M22), each with where it came from and "Not this cover". */
export function FoundCovers({ covers }: { covers: FoundCover[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [line, setLine] = useState("");

  async function reject(c: FoundCover) {
    setBusy(c.id);
    const res = await fetch(`/api/covers/${c.id}/reject`, { method: "POST" }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { status?: string; error?: string }) : {};
    setBusy(null);
    if (!res || !res.ok) {
      setLine(body.error ?? `Could not turn down the cover of “${c.title}”. Try again in a moment.`);
      return;
    }
    setLine(
      body.status === "replaced"
        ? `“${c.title}”: cover turned down; the next match is shown.`
        : `“${c.title}”: cover turned down; no other was found, so it has its drawn cover again.${body.error ? ` ${body.error}` : ""}`,
    );
    router.refresh();
  }

  return (
    <>
      <p className={styles.status} aria-live="polite" data-testid="reject-status">
        {line}
      </p>
      <ul className={styles.grid} data-testid="found-covers">
        {covers.map((c) => (
          <li key={c.id} className={styles.item} data-title={c.title}>
            {/* Signed, short-lived URL to the reader's own stored copy; next/image cannot optimise it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.imageUrl} alt={`Cover found for ${c.title}`} className={styles.picture} />
            <p className={styles.itemTitle}>{c.title}</p>
            {c.author ? <p className={styles.itemAuthor}>{c.author}</p> : null}
            <p className={styles.itemSource}>
              {c.pageUrl ? (
                <a href={c.pageUrl} target="_blank" rel="noopener noreferrer">
                  From {c.sourceName}
                </a>
              ) : (
                `From ${c.sourceName}`
              )}
            </p>
            <button type="button" className={styles.reject} onClick={() => reject(c)} disabled={busy !== null} aria-label={`Not this cover: ${c.title}`}>
              {busy === c.id ? "Turning down…" : "Not this cover"}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
