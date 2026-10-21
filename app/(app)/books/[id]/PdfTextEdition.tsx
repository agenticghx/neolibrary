"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import forms from "@/components/forms.module.css";
import styles from "./TextEdition.module.css";

/**
 * "Flowing text from this PDF" (M31), on the page of a PDF that has text of its own (not a scan), for the library's
 * owner: its own text laid out again as a flowing book, free and without AI. The PDF stays the original; in the
 * reader, Scan | Text switches between them.
 */
export function PdfTextEdition({ bookId, editionId }: { bookId: string; editionId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(editionId);
  const [note, setNote] = useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await fetch(`/api/books/${bookId}/text-edition/from-text`, { method: "POST" }).catch(() => null);
    const data = (res ? await res.json().catch(() => ({})) : {}) as { editionId?: string; read?: number; pages?: number; error?: string };
    setBusy(false);
    if (!res?.ok || !data.editionId) {
      setError(data.error ?? "It could not be made. Try again in a moment.");
      return;
    }
    setMade(data.editionId);
    setNote(`Made from ${data.read} of ${data.pages} pages.`);
    router.refresh();
  };

  return (
    <section className={styles.panel} aria-labelledby="pdf-text-edition" data-testid="pdf-text-edition">
      <h2 id="pdf-text-edition" className={styles.title}>
        Flowing text from this PDF
      </h2>
      <p className={styles.quietText}>
        This PDF has text of its own, so it can be laid out again to flow like an EPUB: any font size, easy on a phone, and chapters for
        Study. No AI is used and nothing is spent; the PDF stays the original.
      </p>
      {made ? (
        <p className={styles.line}>
          <a className={styles.readText} href={`/books/${made}/read`}>
            Read the flowing text
          </a>{" "}
          <span className={styles.quietText}>In the reader, Scan | Text switches between them.</span>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={forms.error}>
          {error}
        </p>
      ) : null}
      <p role="status" className={styles.quietText} data-testid="pdf-text-edition-status">
        {busy ? "Laying the pages out…" : note}
      </p>
      <button type="button" className={styles.button} disabled={busy} onClick={() => void make()}>
        {made ? "Make it again" : "Make the flowing text"}
      </button>
    </section>
  );
}
