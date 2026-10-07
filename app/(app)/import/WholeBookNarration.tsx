"use client";

import { useEffect, useRef, useState } from "react";
import forms from "@/components/forms.module.css";
import type { NarrationSummary } from "@/lib/library/narration";
import styles from "./page.module.css";

/**
 * "Create AI voice narration for an entire book" (M14 follow-up V5; Samuel's
 * decision, 2026-10-06): a separate choice, made on purpose. Choose one of
 * your EPUBs and a voice; the page then says plainly, before anything is
 * made, that this narrates the entire book, how many paragraphs, what it
 * costs (paid up front, minus what is saved already), and where the spending
 * limits would stop it. Create stays disabled until "I understand…" is
 * ticked. Then: progress (saved of total, asked for every second), Stop, and
 * why it stopped.
 *
 * The voices come from the narration route, not from the page: the page must
 * open even when no voice service is set up, and without waiting for one.
 */
type Book = { id: string; title: string; author: string };

const n = (x: number) => x.toLocaleString("en-US");
const dollars = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const about = (x: number) => (x > 0 && x < 0.005 ? "less than $0.01" : `about ${dollars(x)}`);
const percent = (part: number, whole: number) => {
  const p = Math.round((100 * part) / whole);
  return p === 0 && part > 0 ? "less than 1%" : `${p}%`;
};
const label = (b: Book) => (b.author ? `${b.title}, by ${b.author}` : b.title);

function voiceName(s: NarrationSummary) {
  return s.voices.find((v) => v.id === s.voice)?.name ?? s.voice;
}

/** Why the last run stopped, in words, with what is saved now. */
function ended(s: NarrationSummary): string {
  const saved = `${n(s.saved)} of ${n(s.paragraphs)} paragraphs are saved, and play for free.`;
  switch (s.stoppedBecause?.kind) {
    case "finished":
      return `Done: all ${n(s.paragraphs)} paragraphs are saved in the voice ${voiceName(s)}. Open the book and press Listen: it plays for free.`;
    case "stopped":
      return `Stopped, as you asked. ${saved}`;
    case "limit":
      return `Stopped by a spending limit: “${s.stoppedBecause.message}” ${saved}`;
    case "error":
      return `Stopped by an error: “${s.stoppedBecause.message}” ${saved}`;
    default:
      return s.saved === s.paragraphs ? `All ${n(s.paragraphs)} paragraphs are saved in the voice ${voiceName(s)}: it plays for free.` : "";
  }
}

function limitsLine(s: NarrationSummary) {
  const c = s.caps;
  const limits = `Your voice spending limits are ${dollars(c.perBookUsd)} per book (${dollars(c.spentBookUsd)} spent on this book so far) and ${dollars(c.perMonthUsd)} per month (${dollars(c.spentMonthUsd)} spent this month).`;
  if (s.stopsAt === null) return `${limits} They allow all of it.`;
  const stop =
    s.stopsAt <= s.saved
      ? "They leave no room for another paragraph, so nothing can be made now."
      : `They would stop it at about ${percent(s.stopsAt, s.paragraphs)} of the book, with about ${n(s.stopsAt)} of the ${n(s.paragraphs)} paragraphs saved.`;
  return `${limits} ${stop} Only the library's owner can raise the limits, in Railway (VOICE_CAP_PER_BOOK_USD and VOICE_CAP_PER_MONTH_USD).`;
}

export function WholeBookNarration({ books, running }: { books: Book[]; running: { bookId: string; voice: string }[] }) {
  // A run going on when the page opens is shown straight away.
  const [bookId, setBookId] = useState(running[0]?.bookId ?? "");
  const [voice, setVoice] = useState<string | null>(running[0]?.voice ?? null);
  const [summary, setSummary] = useState<NarrationSummary | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<"starting" | "stopping" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to ask the server again: every second while it runs, and after Create or Stop.
  const [tick, setTick] = useState(0);
  const stopButton = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const focusStop = useRef(false);

  // What it involves now, for the book and voice chosen. Only the newest answer counts: an older one
  // (the book or voice changed, or Create or Stop answered meanwhile) is dropped.
  useEffect(() => {
    if (!bookId) return;
    let live = true;
    fetch(`/api/books/${bookId}/narration${voice ? `?voice=${encodeURIComponent(voice)}` : ""}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        // A failed check keeps what is shown (a run going on stays shown, and is asked about again in a second).
        if (!res.ok) {
          setError(data.error ?? "The narration could not be checked. Try again in a moment.");
          return;
        }
        setError(null);
        setSummary(data as NarrationSummary);
        if (!voice) setVoice((data as NarrationSummary).voice);
      })
      .catch(() => {
        if (live) setError("The narration could not be checked. Try again in a moment.");
      });
    return () => {
      live = false;
    };
  }, [bookId, voice, tick]);

  // While it runs, the count is asked for every second.
  const isRunning = !!summary?.running;
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  // Keyboard and screen-reader users land on Stop once it is there, and on the outcome after Stop.
  useEffect(() => {
    if (isRunning && focusStop.current) {
      focusStop.current = false;
      stopButton.current?.focus();
    }
  }, [isRunning]);

  // The voice chosen stays chosen for the next book (the voices are the same for every book).
  const chooseBook = (id: string) => {
    setBookId(id);
    setSummary(null);
    setAgreed(false);
    setError(null);
  };
  const chooseVoice = (id: string) => {
    setVoice(id);
    setAgreed(false);
  };

  const create = async () => {
    if (!summary) return;
    setBusy("starting");
    setError(null);
    const res = await fetch(`/api/books/${bookId}/narration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice: summary.voice, confirm: agreed }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : null;
    setTick((x) => x + 1);
    setBusy(null);
    setAgreed(false);
    if (!res?.ok) {
      setError(data?.error ?? "It could not be started. Try again in a moment.");
      return;
    }
    focusStop.current = true;
    setSummary(data as NarrationSummary);
  };

  const stop = async () => {
    if (!summary) return;
    setBusy("stopping");
    const res = await fetch(`/api/books/${bookId}/narration?voice=${encodeURIComponent(summary.voice)}`, { method: "DELETE" }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : null;
    setTick((x) => x + 1);
    setBusy(null);
    if (!res?.ok) {
      setError(data?.error ?? "It could not be stopped. Try again in a moment.");
      return;
    }
    setSummary(data as NarrationSummary);
    status.current?.focus();
  };

  const s = summary;
  const canMake = s && !s.running && s.saved < s.paragraphs;
  // Create (or Continue) only when the spending limits leave room for at least one more paragraph.
  const room = !!s && (s.stopsAt === null || s.stopsAt > s.saved);
  return (
    <div className={styles.narration}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="narrate-book" className={forms.label}>
            Book to narrate
          </label>
          <select id="narrate-book" className={`${forms.input} ${styles.select}`} value={bookId} onChange={(e) => chooseBook(e.currentTarget.value)}>
            <option value="" disabled>
              Choose one of your EPUBs
            </option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {label(b)}
              </option>
            ))}
          </select>
        </div>
        {s ? (
          <div className={styles.field}>
            <label htmlFor="narrate-voice" className={forms.label}>
              Voice
            </label>
            <select id="narrate-voice" className={`${forms.input} ${styles.select}`} value={s.voice} onChange={(e) => chooseVoice(e.currentTarget.value)}>
              {s.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {s && canMake ? (
        <div className={styles.summary} data-testid="narration-summary">
          <p>
            <strong>This narrates the entire book</strong>, <cite>{s.book.title}</cite>: all {n(s.paragraphs)} paragraphs ({n(s.characters)} characters), in
            the voice {voiceName(s)}.
          </p>
          <p>
            The whole book costs {about(s.totalUsd)}, at {dollars(s.usdPer1kChars)} per 1,000 characters. It is paid up front: every paragraph is made and
            paid for now, not when you listen. Then the whole book plays for free.
          </p>
          {s.saved > 0 ? (
            <p>
              {n(s.saved)} of its paragraphs are already saved in this voice and are not paid for again, so what is left ({n(s.toMake.paragraphs)}{" "}
              {s.toMake.paragraphs === 1 ? "paragraph" : "paragraphs"}) costs {about(s.estimateUsd)}.
            </p>
          ) : null}
          <p>{limitsLine(s)}</p>
        </div>
      ) : null}

      {s && canMake && room ? (
        <div className={styles.confirm}>
          <label className={styles.agree}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.currentTarget.checked)} disabled={busy !== null} />
            <span>I understand this makes narration for the entire book and costs {about(s.estimateUsd)}</span>
          </label>
          <button type="button" className={styles.button} disabled={!agreed || busy !== null} onClick={() => void create()}>
            {s.saved > 0 ? "Continue narration" : "Create narration"}
          </button>
        </div>
      ) : null}

      {s?.running ? (
        <div className={styles.run}>
          <p className={styles.note} data-testid="narration-progress">
            {n(s.saved)} of {n(s.paragraphs)} paragraphs saved ({percent(s.saved, s.paragraphs)}).
          </p>
          <progress className={styles.meter} max={s.paragraphs} value={s.saved} aria-label="Paragraphs saved" />
          <div className={styles.runActions}>
            <button type="button" ref={stopButton} className={styles.quiet} onClick={() => void stop()} disabled={busy === "stopping" || s.stopping}>
              Stop
            </button>
            <span className={styles.note}>Stop lets the paragraph being made finish (it is paid for, so it is saved), then stops.</span>
          </div>
          <p className={styles.note}>
            You can leave this page: it carries on. It stops if the app restarts (after an update); then choose the book again to continue. Saved paragraphs
            are never paid for twice.
          </p>
        </div>
      ) : null}

      <p role="status" ref={status} tabIndex={-1} className={styles.outcome} data-testid="narration-status">
        {s ? (s.running ? (s.stopping || busy === "stopping" ? "Stopping…" : "Making the narration in the background.") : ended(s)) : ""}
      </p>
      {error ? (
        <p role="alert" className={forms.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
