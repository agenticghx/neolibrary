"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import forms from "@/components/forms.module.css";
import type { TextEditionSummary } from "@/lib/library/text-edition";
import styles from "./TextEdition.module.css";

/**
 * "A text edition of this scan" (M25 S7, docs/scan-to-text-plan.md), on a
 * scanned PDF's page, for the library's owner. Before: what it is, how many
 * pages, the most it costs against the book's AI limit, and nothing starts
 * until "I understand…" is ticked. While it runs: pages read of pages sent,
 * asked for every few seconds, and Stop. After: the edition to read, the
 * pages to check against the scan, and any page that could not be read.
 */
const dollars = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const about = (x: number) => (x > 0 && x < 0.005 ? "less than $0.01" : `about ${dollars(x)}`);
const pages = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "page" : "pages"}`;
const scanAt = (bookId: string, page: number) => `/books/${bookId}/read?at=${encodeURIComponent(`epubcfi(/6/${page * 2})`)}`;

export function TextEdition({ bookId, initial }: { bookId: string; initial: TextEditionSummary }) {
  const [s, setS] = useState(initial);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<"starting" | "stopping" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const running = s.job?.status === "preparing" || s.job?.status === "waiting";

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/books/${bookId}/text-edition`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setS((await res.json()) as TextEditionSummary);
  }, [bookId]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [running, refresh]);

  const send = async (method: "POST" | "DELETE") => {
    setBusy(method === "POST" ? "starting" : "stopping");
    setError(null);
    const res = await fetch(`/api/books/${bookId}/text-edition`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify({ confirm: agreed }) : undefined,
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : null;
    setBusy(null);
    setAgreed(false);
    if (!res?.ok) {
      setError(data?.error ?? (method === "POST" ? "It could not be started. Try again in a moment." : "It could not be stopped. Try again in a moment."));
      return;
    }
    setS(data as TextEditionSummary);
    if (method === "POST") requestAnimationFrame(() => stopButton.current?.focus());
    else status.current?.focus();
  };

  const left = s.pageCount - s.done;
  const job = s.job;
  return (
    <section className={styles.panel} aria-labelledby="text-edition">
      <h2 id="text-edition" className={styles.title}>
        Text edition
      </h2>

      {s.editionId ? (
        <p className={styles.line}>
          <a className={styles.readText} href={`/books/${s.editionId}/read`}>
            Read the text edition
          </a>{" "}
          <span className={styles.quietText}>The same book as flowing text; in the reader, Scan | Text switches between them.</span>
        </p>
      ) : null}

      {!running && left > 0 ? (
        <div className={styles.summary} data-testid="text-edition-summary">
          <p>
            Claude reads {s.done ? `the ${pages(left)} not read yet` : `every page of this scan (${pages(s.pageCount)})`} and writes it out as flowing
            text: your font size, Focus and Night work on it, as in any EPUB. The scan stays as it is, and each page of the text leads back to it.
          </p>
          <p>
            It costs {about(s.estimateUsd)} at most (blank pages are skipped and cost nothing), paid as the pages are read, usually within an hour.
          </p>
          <p className={styles.quietText}>
            This book&rsquo;s AI limit is {dollars(s.caps.perBookUsd)}, with {dollars(s.spent.book)} spent; this month&rsquo;s is{" "}
            {dollars(s.caps.perMonthUsd)}, with {dollars(s.spent.month)} spent.
          </p>
        </div>
      ) : null}

      {!running && left > 0 && s.overLimit ? (
        <p role="alert" className={forms.error}>
          {s.overLimit}
        </p>
      ) : null}

      {!running && left > 0 && !s.overLimit ? (
        <div className={styles.confirm}>
          <label className={styles.agree}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.currentTarget.checked)} disabled={busy !== null} />
            <span>
              I understand this reads {pages(left)} with Claude and costs {about(s.estimateUsd)} at most
            </span>
          </label>
          <button type="button" className={styles.button} disabled={!agreed || busy !== null} onClick={() => void send("POST")}>
            {s.editionId ? "Read the rest" : "Make a text edition"}
          </button>
        </div>
      ) : null}

      {running && job ? (
        <div className={styles.run}>
          <p className={styles.line} data-testid="text-edition-progress">
            {job.status === "preparing"
              ? `Sending the pages to Claude: ${pages(job.sent)} sent so far.`
              : `${job.read.toLocaleString("en-US")} of ${pages(job.sent)} read.`}
          </p>
          <progress className={styles.meter} max={Math.max(1, job.sent)} value={job.read} aria-label="Pages read" />
          <div className={styles.runActions}>
            <button
              type="button"
              ref={stopButton}
              className={styles.quiet}
              onClick={() => void send("DELETE")}
              disabled={busy === "stopping" || job.stopRequested}
            >
              Stop
            </button>
            <span className={styles.quietText}>Pages not read yet are not charged.</span>
          </div>
          <p className={styles.quietText}>Anthropic answers within 24 hours, usually within an hour. You can leave this page: it carries on.</p>
        </div>
      ) : null}

      <p role="status" ref={status} tabIndex={-1} className={styles.outcome} data-testid="text-edition-status">
        {running ? (job?.stopRequested ? "Stopping…" : "Reading the pages in the background.") : job ? job.message : ""}
      </p>

      {!running && job && job.toCheck.length ? (
        <div className={styles.check}>
          <p className={styles.line}>
            <strong>Pages to check against the scan.</strong> Claude&rsquo;s reading and the scan&rsquo;s own text disagree here: often the scan&rsquo;s
            text is the one at fault (a table, a picture), but a word may be wrong.
          </p>
          <ul className={styles.pages}>
            {job.toCheck.map((c) => (
              <li key={c.page}>
                <a href={scanAt(bookId, c.page)}>Page {c.page}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!running && job && job.problems.length ? (
        <div className={styles.check}>
          <p className={styles.line}>
            <strong>Pages not read.</strong>
          </p>
          <ul className={styles.problems}>
            {job.problems.map((p) => (
              <li key={p.page}>
                <a href={scanAt(bookId, p.page)}>Page {p.page}</a>: {p.message}
              </li>
            ))}
          </ul>
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
