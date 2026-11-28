"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ACCEPT, UPLOAD_MESSAGES, useBookUpload } from "./useBookUpload";
import styles from "./QuickPaperUpload.module.css";

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

/**
 * Option A · 1-click paper upload on the Papers page (/library?show=papers):
 * - Single "+ Add paper" button opens the OS file picker immediately and files
 *   every chosen file under Papers (kind="paper").
 * - Dragging any PDF/EPUB/Markdown file anywhere onto the Papers page shows a
 *   drop veil and uploads directly to Papers.
 * - Instant result banner with direct "Open" link for every outcome (including
 *   duplicates) and a 1-click "File under Papers" button for existing books.
 */
export function PapersHeaderWithUpload({
  eyebrow,
  title,
  countText,
  allLibraryHref,
}: {
  eyebrow: string;
  title: string;
  countText: string;
  allLibraryHref: string;
}) {
  const router = useRouter();
  const { input, busy, results, error, upload } = useBookUpload();
  const [over, setOver] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [filedIds, setFiledIds] = useState<Record<string, "saving" | "done" | "error">>({});
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    let depth = 0;
    const clear = () => {
      depth = 0;
      setOver(false);
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const overIt = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      clear();
      if (!busyRef.current && e.dataTransfer?.files.length) {
        setDismissed(false);
        void upload(e.dataTransfer.files, "paper");
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overIt);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overIt);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragend", clear);
      window.removeEventListener("blur", clear);
    };
  }, [upload]);

  const markPaper = async (bookId: string) => {
    setFiledIds((m) => ({ ...m, [bookId]: "saving" }));
    try {
      const res = await fetch(`/api/books/${bookId}/paper`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markOnly: true }),
      });
      if (!res.ok) throw new Error();
      setFiledIds((m) => ({ ...m, [bookId]: "done" }));
      router.refresh();
    } catch {
      setFiledIds((m) => ({ ...m, [bookId]: "error" }));
    }
  };

  const showResults = !dismissed && (results.length > 0 || Boolean(error));

  return (
    <>
      {over ? (
        <div className={styles.dropVeil} aria-hidden="true">
          <div className={styles.dropBadge}>Drop to add directly to Papers</div>
        </div>
      ) : null}

      <header className={styles.head}>
        <div className={styles.headCopy}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.lede}>
            <span>{countText}</span> <Link href={allLibraryHref}>Show the whole library</Link>
          </p>
        </div>

        <label className={busy ? `${styles.addButton} ${styles.addButtonBusy}` : styles.addButton}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>{busy ? "Uploading…" : "Add paper"}</span>
          <input
            ref={input}
            type="file"
            name="files"
            multiple
            accept={ACCEPT}
            className="visually-hidden"
            disabled={busy}
            onChange={(e) => {
              if (!e.target.files?.length) return;
              setDismissed(false);
              void upload(e.target.files, "paper");
            }}
          />
        </label>
      </header>

      {showResults ? (
        <section className={styles.resultBox} aria-live="polite" data-testid="paper-upload-results">
          {error ? (
            <p role="alert" className={styles.resultError}>
              {error}
            </p>
          ) : null}
          {results.length ? (
            <ul className={styles.resultList}>
              {results.map((r, i) => {
                if (r.status === "error") {
                  return (
                    <li key={`${r.file}-${i}`} className={styles.resultRow}>
                      <span className={styles.resultError}>
                        <strong>{r.file}</strong> · {r.message}
                      </span>
                    </li>
                  );
                }
                const filed = filedIds[r.bookId];
                const isDup = r.status === "duplicate";
                return (
                  <li key={`${r.bookId}-${i}`} className={styles.resultRow}>
                    <div className={styles.resultMeta}>
                      <span className={styles.pill}>{filed === "done" ? "Filed under Papers" : isDup ? "Already in library" : "Added to Papers"}</span>
                      <span className={styles.resultTitle}>{r.title}</span>
                      {!isDup && r.note ? <span className={styles.resultNote}>{r.note}</span> : null}
                      {r.status !== "added" && r.status !== "duplicate" ? <span className={styles.resultNote}>{UPLOAD_MESSAGES[r.status]}</span> : null}
                    </div>
                    <div className={styles.resultActions}>
                      {isDup && filed !== "done" ? (
                        <button type="button" className={styles.ghostBtn} disabled={filed === "saving"} onClick={() => void markPaper(r.bookId)}>
                          {filed === "saving" ? "Filing…" : filed === "error" ? "Retry" : "+ File under Papers"}
                        </button>
                      ) : null}
                      <Link href={`/books/${r.bookId}`} className={styles.ghostBtn}>
                        Open
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <button type="button" className={styles.dismissBtn} aria-label="Dismiss upload results" onClick={() => setDismissed(true)}>
            ×
          </button>
        </section>
      ) : null}
    </>
  );
}
