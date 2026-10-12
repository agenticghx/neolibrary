"use client";

import { useState } from "react";
import { catalogueName } from "@/lib/covers/names";
import type { Choosing } from "./ChooseCover";
import styles from "./page.module.css";

export type FoundCover = { id: string; title: string; author: string; imageUrl: string; pageUrl: string | null; source: string };

/** The found covers (M22), each with where it came from, "Not this cover" and "Choose another" (C3a). */
export function FoundCovers({ covers, onStatus, onChoose }: { covers: FoundCover[]; onStatus: (line: string, changed?: boolean) => void; onChoose: (b: Choosing) => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function reject(c: FoundCover) {
    setBusy(c.id);
    const res = await fetch(`/api/covers/${c.id}/reject`, { method: "POST" }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { status?: string; error?: string }) : {};
    setBusy(null);
    if (!res || !res.ok) {
      onStatus(body.error ?? `Could not turn down the cover of “${c.title}”. Try again in a moment.`);
      return;
    }
    onStatus(
      body.status === "replaced"
        ? `“${c.title}”: cover turned down; the next match is shown.`
        : `“${c.title}”: cover turned down; no other was found, so it has its drawn cover again.${body.error ? ` ${body.error}` : ""}`,
      true,
    );
  }

  return (
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
                From {catalogueName(c.source)}
              </a>
            ) : (
              `From ${catalogueName(c.source)}`
            )}
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.reject} onClick={() => reject(c)} disabled={busy !== null} aria-label={`Not this cover: ${c.title}`}>
              {busy === c.id ? "Turning down…" : "Not this cover"}
            </button>
            <button type="button" className={styles.reject} onClick={() => onChoose(c)} disabled={busy !== null} aria-label={`Choose another cover: ${c.title}`}>
              Choose another
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
