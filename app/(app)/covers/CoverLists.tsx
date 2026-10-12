"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChooseCover, type Choosing } from "./ChooseCover";
import { FoundCovers, type FoundCover } from "./FoundCovers";
import styles from "./page.module.css";

/**
 * The Covers page's two lists (M22): the found covers, and the titles without one, each with a way to choose a
 * cover by hand (C3a). One status line and one chooser for both, kept here, so a title moving from one list to
 * the other takes neither with it.
 */
export function CoverLists({ found, none }: { found: FoundCover[]; none: Choosing[] }) {
  const router = useRouter();
  const [line, setLine] = useState("");
  const [choosing, setChoosing] = useState<Choosing | null>(null);

  const report = (text: string, changed?: boolean) => {
    setLine(text);
    if (changed) router.refresh();
  };

  return (
    <>
      <section aria-labelledby="found-h" className={styles.section}>
        <h2 id="found-h" className={styles.sectionTitle}>
          Found <span className={styles.count}>({found.length})</span>
        </h2>
        <p className={styles.status} aria-live="polite" data-testid="reject-status" tabIndex={-1}>
          {line}
        </p>
        {found.length ? <FoundCovers covers={found} onStatus={report} onChoose={setChoosing} /> : <p className={styles.note}>No covers found yet.</p>}
      </section>

      <section aria-labelledby="none-h" className={styles.section}>
        <h2 id="none-h" className={styles.sectionTitle}>
          No cover found <span className={styles.count}>({none.length})</span>
        </h2>
        {none.length ? (
          <>
            <p className={styles.note}>These keep their drawn cover. The catalogues are asked about them again every 30 days, or choose one yourself.</p>
            <ul className={styles.list} data-testid="no-cover">
              {none.map((b) => (
                <li key={b.id} className={styles.noneItem}>
                  <span>
                    <span className={styles.listTitle}>{b.title}</span>
                    {b.author ? <span className={styles.listAuthor}> · {b.author}</span> : null}
                  </span>
                  <button type="button" className={styles.chooseLink} onClick={() => setChoosing(b)} aria-label={`Choose a cover: ${b.title}`}>
                    Choose a cover
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.note}>Every title has a cover.</p>
        )}
      </section>

      {choosing ? (
        <ChooseCover
          key={choosing.id}
          book={choosing}
          onClose={() => setChoosing(null)}
          onDone={(text) => {
            setChoosing(null);
            report(text, true);
          }}
        />
      ) : null}
    </>
  );
}
