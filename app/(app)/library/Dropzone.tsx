"use client";

import { useState } from "react";
import { ACCEPT, UPLOAD_MESSAGES, useBookUpload } from "@/components/upload/useBookUpload";
import styles from "./page.module.css";

/** Drag-and-drop (or pick) EPUB and PDF files; several at once. */
export function Dropzone() {
  const { input, busy, results, error, upload } = useBookUpload();
  const [over, setOver] = useState(false);

  return (
    <div className={styles.upload}>
      <div
        className={[styles.drop, over ? styles.dropOver : ""].join(" ")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <p className={styles.dropTitle}>{busy ? "Reading your books…" : "Drop EPUB or PDF files here"}</p>
        <p className={styles.dropNote}>DRM-free files only. Several at once is fine.</p>
        <label className={styles.pick}>
          Choose files
          <input
            ref={input}
            type="file"
            name="files"
            multiple
            accept={ACCEPT}
            className="visually-hidden"
            disabled={busy}
            onChange={(e) => e.target.files && void upload(e.target.files)}
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {results.length ? (
        <ul className={styles.results} aria-live="polite" data-testid="upload-results">
          {results.map((r, i) => (
            <li key={`${r.file}-${i}`} className={r.status === "error" ? styles.resultError : undefined}>
              <span className={styles.resultFile}>{r.status === "error" ? r.file : r.title}</span>
              <span className={styles.resultNote}>{r.status === "error" ? r.message : UPLOAD_MESSAGES[r.status]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
