"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { UploadOutcome } from "@/app/api/books/route";
import styles from "./page.module.css";

const MESSAGES = {
  added: "Added to your shelf",
  attached: "Attached to the wanted book in your path",
  duplicate: "Already on your shelf",
} as const;

/** Drag-and-drop (or pick) EPUB and PDF files; several at once. */
export function Dropzone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    setError(null);
    const body = new FormData();
    for (const f of list) body.append("files", f);
    try {
      const res = await fetch("/api/books", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed.");
      setResults(json.results);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

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
            accept=".epub,.pdf,application/epub+zip,application/pdf"
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
              <span className={styles.resultNote}>{r.status === "error" ? r.message : MESSAGES[r.status]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
