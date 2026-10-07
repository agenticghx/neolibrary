"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { ACCEPT, UPLOAD_MESSAGES, useBookUpload } from "./useBookUpload";
import styles from "./HomeImport.module.css";

type Upload = ReturnType<typeof useBookUpload>;
const Ctx = createContext<Upload | null>(null);
const useUpload = () => {
  const u = useContext(Ctx);
  if (!u) throw new Error("HomeImport parts must sit inside <ImportRoot>.");
  return u;
};

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

/**
 * The Import page accepts book files dropped anywhere in the window, the
 * sidebar and tabs too (M14 follow-up V3a: Import is the one place to add
 * books; Home and the Library no longer take drops); a dropped file never
 * makes the browser leave the app to open it. Only file drags are claimed:
 * text and links behave as usual. A counter of drag enters and leaves keeps
 * the outline steady (Safari gives dragleave no relatedTarget).
 */
export function ImportRoot({ className, children }: { className?: string; children: React.ReactNode }) {
  const upload = useBookUpload();
  const { upload: send } = upload;
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
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
      depth = 0;
      setOver(false);
      if (e.dataTransfer?.files.length) void send(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overIt);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overIt);
      window.removeEventListener("drop", drop);
    };
  }, [send]);
  return (
    <Ctx.Provider value={upload}>
      <main className={[className, over ? styles.over : ""].join(" ")} data-testid="import-drop">
        {children}
      </main>
    </Ctx.Provider>
  );
}

/**
 * Home's Import, beside the page title (M14 follow-up V3a): to the Import page, the one place where books and
 * audiobooks are added (Samuel, #90). Round, icon only, on a phone.
 */
export function ImportLink() {
  return (
    <Link href="/import" className={styles.importButton}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
      </svg>
      <span className={styles.importLabel}>Import</span>
    </Link>
  );
}

/** The dashed hint, with Choose files, and what happened to each file. */
export function ImportZone() {
  const { input, busy, results, read, error, upload } = useUpload();
  return (
    <div className={styles.zoneWrap}>
      <p role="status" className="visually-hidden">
        {busy ? "Reading your books…" : read ? `${read === 1 ? "1 file" : `${read} files`} read.` : ""}
      </p>
      <div className={styles.zone}>
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" className={styles.zoneIcon} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
        </svg>
        <p className={styles.zoneText}>{busy ? "Reading your books…" : "Drop your DRM-free books (EPUB, PDF) anywhere on this page."}</p>
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
