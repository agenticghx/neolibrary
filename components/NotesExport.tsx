"use client";

import { useState } from "react";
import styles from "./NotesExport.module.css";

const MAILTO_LIMIT = 1800; // long mailto links get cut off by mail apps

/** Take your notes on a book elsewhere: download, copy, or email. */
export function NotesExport({ bookId, title }: { bookId: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const base = `/api/books/${bookId}/annotations/export`;
  const markdown = async () => (await fetch(`${base}?format=md`)).text();

  return (
    <div className={styles.exports} role="group" aria-label="Export notes">
      <a className={styles.link} href={`${base}?format=md`} download>
        Markdown
      </a>
      <a className={styles.link} href={`${base}?format=w3c`} download>
        W3C JSON
      </a>
      <button
        type="button"
        className={styles.link}
        onClick={async () => {
          await navigator.clipboard?.writeText(await markdown()).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy all"}
      </button>
      <button
        type="button"
        className={styles.link}
        onClick={async () => {
          let body = await markdown();
          if (body.length > MAILTO_LIMIT) body = `${body.slice(0, MAILTO_LIMIT)}\n\n… (download the Markdown file for the rest)`;
          location.href = `mailto:?subject=${encodeURIComponent(`Notes on ${title}`)}&body=${encodeURIComponent(body)}`;
        }}
      >
        Email
      </button>
    </div>
  );
}

/** Bring back highlights and notes from a W3C Web Annotation file. */
export function NotesImport({ bookId }: { bookId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className={styles.import}>
      <label className={styles.importLabel} htmlFor="annotations-file">
        Import W3C annotations (.json)
      </label>
      <input
        id="annotations-file"
        className={styles.file}
        type="file"
        accept="application/json,application/ld+json,.json,.jsonld"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const res = await fetch(`/api/books/${bookId}/annotations/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: await file.text(),
          });
          const json = await res.json().catch(() => ({}));
          setMessage(
            res.ok
              ? `Added ${json.added} ${json.added === 1 ? "annotation" : "annotations"}${json.skipped ? `; ${json.skipped} already here` : ""}.`
              : json.error ?? "Import failed.",
          );
          e.target.value = "";
        }}
      />
      {message ? (
        <p role="status" className={styles.message}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
