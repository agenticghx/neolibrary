"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import forms from "@/components/forms.module.css";
import {
  type ImportSummary,
  megabytes,
  packageFiles,
  placedWords,
  size,
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
 *
 * Screen readers hear only the steps (the role="status" line); the running
 * "N of M MB" sits in a separate line and in the progress bar, so a long
 * upload is not read out every 8 MB.
 */
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function step(p: UploadProgress) {
  switch (p.stage) {
    case "checking":
      return "Checking the package against this book…";
    case "fingerprints":
      return `Checking the audio on this computer (${size(p.totalBytes)})…`;
    case "sending-zip":
      return `Sending the .zip (${size(p.totalBytes)}). This can take a few minutes; keep this page open.`;
    case "sending":
      return `Sending the audio (${size(p.totalBytes)}). This can take a few minutes; keep this page open.`;
    case "finishing":
      return "Checking the audio and saving the timings…";
    case "done":
      return "Done.";
  }
}

export function AudiobookUpload({ bookId, imports }: { bookId: string; imports: ImportSummary[] }) {
  const router = useRouter();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // During the last step the bar stays full ("All 201 MB sent"), so the count
  // is seen to reach the end before the server's checks begin.
  const [audioTotal, setAudioTotal] = useState(0);
  const onProgress = (p: UploadProgress) => {
    if (p.stage === "sending") setAudioTotal(p.totalBytes);
    setProgress(p);
  };
  const heading = useRef<HTMLHeadingElement>(null);
  const section = useRef<HTMLElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const cancel = useRef<AbortController | null>(null);
  const ready = imports.find((i) => i.status === "ready") ?? null;
  const unfinished = imports.filter((i) => i.status === "uploading");

  // An upload stops when the reader leaves this page (and the browser asks first).
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  useEffect(() => () => cancel.current?.abort(), []);

  const settle = () => {
    setBusy(false);
    cancel.current = null;
    router.refresh();
    // The busy state disabled the focused control, which drops focus to the
    // page: start again from this section, unless the reader has moved on.
    const at = document.activeElement;
    if (!at || at === document.body || section.current?.contains(at)) heading.current?.focus();
  };

  // While an upload runs the pickers are disabled; put focus on Cancel so
  // keyboard and screen-reader users are not left on nothing.
  const cancellable = busy && progress !== null && progress.stage !== "finishing" && progress.stage !== "done";
  useEffect(() => {
    if (cancellable && (document.activeElement === document.body || !document.activeElement)) cancelButton.current?.focus();
  }, [cancellable]);

  const send = async (list: FileList | null, kind: "folder" | "zip") => {
    if (!list?.length) return;
    cancel.current = new AbortController();
    setBusy(true);
    setError(null);
    setMessage("");
    setAudioTotal(0);
    setProgress({ stage: "checking" });
    try {
      const picked =
        kind === "zip"
          ? [{ path: list[0].name, blob: list[0] }]
          : packageFiles([...list].map((f) => ({ name: f.name, webkitRelativePath: f.webkitRelativePath, blob: f })));
      await uploadPackage(bookId, picked, { onProgress, signal: cancel.current.signal });
      setMessage("Done.");
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "The upload stopped. Choose the folder again to start over.");
    } finally {
      setProgress(null);
      settle();
    }
  };

  /** Sends what an input holds, then clears it so the same folder can be chosen again. */
  const pick = async (input: HTMLInputElement, kind: "folder" | "zip") => {
    const files = input.files;
    await send(files, kind);
    input.value = "";
  };

  const remove = async (id: string, what: string) => {
    setBusy(true);
    setError(null);
    setMessage(""); // so the same message twice is announced twice
    const res = await fetch(`/api/books/${bookId}/readalong/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) setMessage(`Removed ${what}: its audio and word timings are gone from this book.`);
    else setError("It could not be removed. Try again in a moment.");
    settle();
  };

  const sending = progress?.stage === "sending" ? progress : progress?.stage === "finishing" && audioTotal ? { sentBytes: audioTotal, totalBytes: audioTotal } : null;
  return (
    <section ref={section} className={styles.notes} aria-labelledby="audiobook">
      <h2 id="audiobook" ref={heading} tabIndex={-1} className={`${styles.collectionsTitle} ${styles.landing}`}>
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
          <p className={styles.notesSummary}>
            To read along, open the book and press Listen: your audiobook plays from where you are (or from where it begins), and each word lights up as it
            is spoken.
          </p>
          <div className={styles.audiobookActions}>
            <button
              type="button"
              className={styles.quiet}
              disabled={busy}
              onClick={() => void remove(ready.id, ready.title || "the audiobook")}
              aria-label={`Remove ${ready.title || "this audiobook"}`}
            >
              Remove
            </button>
            <span className={styles.notesSummary}>Removes its audio and word timings from this book.</span>
          </div>
        </div>
      ) : (
        <p className={styles.notesSummary}>
          Add an audiobook of this book to read along with it: each word lights up as it is spoken. Choose the read-along folder made on your laptop
          with the readalong-audio skill (it holds the audio, the scripts and the word timings). Then press Listen in the book to play it.
        </p>
      )}

      {unfinished.map((u) => (
        <div key={u.id} className={styles.audiobookActions}>
          <span className={styles.notesSummary}>
            An upload from {day(u.createdAt)} did not finish and cannot be continued. Choose the folder again to start over, or remove it.
          </span>
          <button
            type="button"
            className={styles.quiet}
            disabled={busy}
            onClick={() => void remove(u.id, "the unfinished upload")}
            aria-label={`Remove the unfinished upload from ${dayTime(u.createdAt)}`}
          >
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
          or a .zip of it (up to 50 MB)
          <input type="file" accept=".zip,application/zip" className="visually-hidden" disabled={busy} onChange={(e) => void pick(e.currentTarget, "zip")} />
        </label>
        {cancellable ? (
          <button type="button" ref={cancelButton} className={styles.quiet} onClick={() => cancel.current?.abort()}>
            Cancel the upload
          </button>
        ) : null}
      </div>

      {progress?.stage === "sending-zip" ? <progress className={styles.meter} aria-label="Sending the .zip" /> : null}
      {sending ? (
        <div className={styles.audiobookProgress}>
          <progress className={styles.meter} max={sending.totalBytes} value={sending.sentBytes} aria-label="Audio sent so far" />
          <p className={styles.notesSummary} data-testid="audiobook-sent">
            {sending.sentBytes >= sending.totalBytes ? `All ${size(sending.totalBytes)} sent` : `${megabytes(sending.sentBytes, sending.totalBytes)} sent`}
          </p>
        </div>
      ) : null}
      <p role="status" className={styles.notesSummary} data-testid="audiobook-status">
        {progress ? step(progress) : message}
      </p>
      {error ? (
        <p role="alert" className={forms.error}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
