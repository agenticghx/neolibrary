"use client";

import { createContext, useContext, useState } from "react";
import { ACCEPT, UPLOAD_MESSAGES, useBookUpload } from "./useBookUpload";
import styles from "./HomeImport.module.css";

type Upload = ReturnType<typeof useBookUpload>;
const Ctx = createContext<Upload | null>(null);
const useUpload = () => {
  const u = useContext(Ctx);
  if (!u) throw new Error("HomeImport parts must sit inside <ImportRoot>.");
  return u;
};

/** Home accepts book files dropped anywhere on the page (Samuel's pick: "Home = Continue, the library, with Import"). */
export function ImportRoot({ className, children }: { className?: string; children: React.ReactNode }) {
  const upload = useBookUpload();
  const [over, setOver] = useState(false);
  return (
    <Ctx.Provider value={upload}>
      <main
        className={[className, over ? styles.over : ""].join(" ")}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setOver(false);
          void upload.upload(e.dataTransfer.files);
        }}
      >
        {children}
      </main>
    </Ctx.Provider>
  );
}

/** The Import button beside the page title: opens the file picker (round, icon only, on a phone). */
export function ImportButton() {
  const { input, busy } = useUpload();
  return (
    <button type="button" className={styles.importButton} onClick={() => input.current?.click()} disabled={busy}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
      </svg>
      <span className={styles.importLabel}>Import</span>
    </button>
  );
}

/** The dashed hint above the library, with Choose files, and what happened to each file. */
export function ImportZone() {
  const { input, busy, results, error, upload } = useUpload();
  return (
    <div className={styles.zoneWrap}>
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
