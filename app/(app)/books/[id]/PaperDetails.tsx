"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import forms from "@/components/forms.module.css";
import styles from "./page.module.css";

/**
 * M41 R3: a title's paper details on its page. A paper shows its authors, year and journal, and links to its DOI and
 * PubMed pages; "This is not a paper" makes it a book again. A book offers "Is this a research paper?": its DOI or
 * PubMed ID fills in the real title, authors, year and journal from Crossref or PubMed.
 */
export function PaperDetails({
  bookId,
  paper,
  sharing,
}: {
  bookId: string;
  paper: { byline: string; doi: string | null; pmid: string | null } | null;
  /**
   * M41 R3c: on the owner's paper, whether it is shared with invited readers and how many have it; on a reader's copy,
   * who shared it (then its details cannot be changed here).
   */
  sharing?: { owner: { on: boolean; readers: number } } | { by: string };
}) {
  const router = useRouter();
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/paper`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ share: on }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(body.error ?? "That did not work. Try again.");
      else router.refresh();
    } catch {
      setError("The library could not be reached. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/paper`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify({ id }) : undefined,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "That did not work. Try again.");
        return;
      }
      setId("");
      router.refresh();
    } catch {
      setError("The library could not be reached. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (paper) {
    return (
      <section className={styles.notes} aria-labelledby="paper-details" data-testid="paper-details">
        <h2 id="paper-details" className={styles.collectionsTitle}>
          Research paper
        </h2>
        <p className={styles.notesSummary}>{paper.byline}</p>
        <p className={styles.notesSummary}>
          {paper.doi ? (
            <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer">
              DOI {paper.doi}
            </a>
          ) : null}
          {paper.doi && paper.pmid ? " · " : null}
          {paper.pmid ? (
            <a href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`} target="_blank" rel="noreferrer">
              PubMed {paper.pmid}
            </a>
          ) : null}
        </p>
        {sharing && "by" in sharing ? (
          <p className={styles.notesSummary} data-testid="paper-shared-by">
            Shared with you by {sharing.by}. Your place, highlights and notes in it are your own.
          </p>
        ) : (
          <>
            {sharing && "owner" in sharing ? (
              <p className={styles.notesSummary} data-testid="paper-sharing">
                {sharing.owner.on
                  ? `Shared with the people you invite: ${sharing.owner.readers === 1 ? "1 reader has it" : `${sharing.owner.readers} readers have it`} in their library, with their own notes.`
                  : "Not shared: only you see it."}{" "}
                <button type="button" className={styles.paperUndo} aria-pressed={sharing.owner.on} onClick={() => share(!sharing.owner.on)} disabled={busy}>
                  {sharing.owner.on ? "Stop sharing" : "Share with invited readers"}
                </button>
              </p>
            ) : null}
            <button type="button" className={styles.paperUndo} onClick={() => send("DELETE")} disabled={busy}>
              This is not a paper
            </button>
          </>
        )}
        {error ? (
          <p role="alert" className={forms.error}>
            {error}
          </p>
        ) : null}
      </section>
    );
  }
  return (
    <details className={styles.paperAsk} data-testid="paper-ask">
      <summary>Is this a research paper?</summary>
      <form
        className={styles.paperForm}
        onSubmit={(e) => {
          e.preventDefault();
          void send("POST");
        }}
      >
        <label htmlFor="paper-id" className={styles.paperLabel}>
          Its DOI or PubMed ID
        </label>
        <p className={styles.paperHint} id="paper-hint">
          For example 10.1016/s0031-6997(25)06847-4 or PMID 7568331. Its title, authors, year and journal are filled in from Crossref or PubMed.
        </p>
        <div className={styles.paperRow}>
          <input
            id="paper-id"
            className={styles.paperInput}
            value={id}
            onChange={(e) => setId(e.target.value)}
            aria-describedby="paper-hint"
            autoComplete="off"
            spellCheck={false}
            required
          />
          <button type="submit" className={styles.paperFind} disabled={busy || !id.trim()}>
            {busy ? "Finding…" : "Find its details"}
          </button>
        </div>
        {error ? (
          <p role="alert" className={forms.error}>
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
