"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import forms from "@/components/forms.module.css";
import {
  type ImportSummary,
  megabytes,
  packageFiles,
  placedWords,
  type UploadProgress,
  uploadPackage,
  UploadError,
} from "@/lib/readalong/upload-client";
import styles from "./page.module.css";

/**
 * M13 (c3): "Your audiobook" on the book's page. The reader chooses the
 * read-along folder made on the laptop by the readalong-audio skill (or a
 * .zip of it, for phones that cannot pick a folder). The scripts go in one
 * request and the audio in 8 MB parts, with progress; the server checks it
 * all against this very book file before anything is kept.
 */
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function status(p: UploadProgress) {
  switch (p.stage) {
    case "checking":
      return "Checking the package against this book…";
    case "sending":
      return `Sending the audio: ${megabytes(p.sentBytes, p.totalBytes)}`;
    case "finishing":
      return "Checking the audio and saving the timings…";
    case "done":
      return "Done."; // the result is shown above, from the page's own data
  }
}

export function AudiobookUpload({ bookId, imports }: { bookId: string; imports: ImportSummary[] }) {
  const router = useRouter();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = imports.find((i) => i.status === "ready") ?? null;
  const unfinished = imports.filter((i) => i.status === "uploading");

  const send = async (list: FileList | null, kind: "folder" | "zip") => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    setProgress({ stage: "checking" });
    try {
      const picked =
        kind === "zip"
          ? [{ path: list[0].name, blob: list[0] }]
          : packageFiles([...list].map((f) => ({ name: f.name, webkitRelativePath: f.webkitRelativePath, blob: f })));
      await uploadPackage(bookId, picked, { onProgress: setProgress });
      router.refresh();
    } catch (e) {
      setProgress(null);
      setError(e instanceof UploadError ? e.message : "The upload stopped. Choose the folder again to retry.");
      router.refresh(); // an unfinished import may now be listed, with Remove
    } finally {
      setBusy(false);
    }
  };

  /** Sends what an input holds, then clears it so the same folder can be chosen again. */
  const pick = async (input: HTMLInputElement, kind: "folder" | "zip") => {
    const files = input.files;
    await send(files, kind);
    input.value = "";
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/books/${bookId}/readalong/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setError("It could not be removed. Try again in a moment.");
    setProgress(null);
    setBusy(false);
    router.refresh();
  };

  return (
    <section className={styles.notes} aria-labelledby="audiobook">
      <h2 id="audiobook" className={styles.collectionsTitle}>
        Your audiobook
      </h2>
      {ready ? (
        <div className={styles.audiobook}>
          <p className={styles.audiobookTitle}>{ready.title || ready.voice || "Your audiobook"}</p>
          <p className={styles.notesSummary}>
            Ready · added {day(ready.finishedAt ?? ready.createdAt)}
            {ready.madeWith ? ` · made with ${ready.madeWith}` : ""}
          </p>
          <p className={styles.notesSummary} data-testid="audiobook-placed">
            {placedWords(ready).text} in {ready.report.chapters.length} {ready.report.chapters.length === 1 ? "chapter" : "chapters"}.
          </p>
          <details className={styles.audiobookChapters}>
            <summary>Chapters</summary>
            <ul>
              {ready.report.chapters.map((c) => (
                <li key={c.n}>
                  {c.title}: {c.matchedWords.toLocaleString("en-US")} of {c.spokenWords.toLocaleString("en-US")} words placed
                </li>
              ))}
            </ul>
          </details>
          <p className={styles.notesSummary}>The Listen button will play it once the read-along player is finished, the next step of this feature.</p>
          <div className={styles.audiobookActions}>
            <button type="button" className={styles.quiet} disabled={busy} onClick={() => void remove(ready.id)} aria-label={`Remove ${ready.title || "this audiobook"}`}>
              Remove
            </button>
            <span className={styles.notesSummary}>Removes its audio and word timings from this book.</span>
          </div>
        </div>
      ) : (
        <p className={styles.notesSummary}>
          Add an audiobook of this book and read along: each word lights up as it is spoken. Choose the read-along folder made on your laptop with the
          readalong-audio skill (it holds the audio, the scripts and the word timings).
        </p>
      )}

      {unfinished.map((u) => (
        <div key={u.id} className={styles.audiobookActions}>
          <span className={styles.notesSummary}>
            Unfinished upload · started {day(u.createdAt)} · waiting for {u.waitingFor.join(", ") || "the audio"}
          </span>
          <button type="button" className={styles.quiet} disabled={busy} onClick={() => void remove(u.id)} aria-label={`Remove the unfinished upload from ${day(u.createdAt)}`}>
            Remove
          </button>
        </div>
      ))}

      <div className={styles.audiobookPick}>
        <label className={[styles.pick, busy ? styles.pickBusy : ""].join(" ")}>
          {ready ? "Replace with another folder" : "Choose the read-along folder"}
          <input type="file" webkitdirectory="" multiple className="visually-hidden" disabled={busy} onChange={(e) => void pick(e.currentTarget, "folder")} />
        </label>
        <label className={styles.pickQuiet}>
          or a .zip of it
          <input type="file" accept=".zip,application/zip" className="visually-hidden" disabled={busy} onChange={(e) => void pick(e.currentTarget, "zip")} />
        </label>
      </div>

      {progress ? (
        <div className={styles.audiobookProgress}>
          {progress.stage === "sending" ? (
            <progress className={styles.meter} max={progress.totalBytes} value={progress.sentBytes} aria-label="Audio sent so far" />
          ) : null}
          <p role="status" className={styles.notesSummary} data-testid="audiobook-status">
            {status(progress)}
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={forms.error}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
