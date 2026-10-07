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

/**
 * Why the last run stopped, in words, with what is saved now. Saved audio plays for free in its own voice only,
 * so every line names the voice (the Listen bar opens in the voice a paragraph is saved in: lib/library/listen.ts).
 */
function ended(s: NarrationSummary): string {
  const saved = `${n(s.saved)} of ${n(s.paragraphs)} paragraphs are saved, and play for free in the voice ${voiceName(s)}.`;
  switch (s.stoppedBecause?.kind) {
    case "finished":
      return `Done: all ${n(s.paragraphs)} paragraphs are saved in the voice ${voiceName(s)}. Open the book and press Listen: in that voice, it plays for free.`;
    case "stopped":
      return `Stopped, as you asked. ${saved}`;
    case "limit":
      return `Stopped by a spending limit: “${s.stoppedBecause.message}” ${saved}`;
    case "error":
      return `Stopped by an error: “${s.stoppedBecause.message}” ${saved}`;
    default:
      return s.saved === s.paragraphs ? `All ${n(s.paragraphs)} paragraphs are saved in the voice ${voiceName(s)}: in that voice, the book plays for free.` : "";
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
  // A run going on when the page opens is shown straight away (one run per reader at a time: lib/library/narration.ts).
  const [bookId, setBookId] = useState(running[0]?.bookId ?? "");
  // The voice chosen: the Voice list shows it, and every check asks about it (null until the first answer names the first voice on offer).
  const [voice, setVoice] = useState<string | null>(running[0]?.voice ?? null);
  const [summary, setSummary] = useState<NarrationSummary | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<"starting" | "stopping" | null>(null);
  // A check that failed (cleared by the next one that answers), and a Create or Stop that failed (kept until the next choice or press).
  const [checkError, setCheckError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Bumped to ask the server again: every second while it runs, after Create or Stop, and by Try again.
  const [tick, setTick] = useState(0);
  const stopButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const voiceList = useRef<HTMLSelectElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  // Where keyboard focus goes next: Stop once it is there; the outcome once Stop is gone; back from Try again once it worked.
  const focusStop = useRef(false);
  const focusStatus = useRef(false);
  const focusAfterRetry = useRef(false);
  // When the check on its way was sent (0: none is on its way).
  const asked = useRef(0);

  // What it involves now, for the book and voice chosen. Only the newest check counts: one sent before the book or
  // voice changed, or before Create or Stop answered, is dropped. The refresh every second waits for the check on its
  // way (see below), so on a slow connection the count still moves and the outcome still shows.
  useEffect(() => {
    if (!bookId) return;
    let live = true;
    asked.current = Date.now();
    fetch(`/api/books/${bookId}/narration${voice ? `?voice=${encodeURIComponent(voice)}` : ""}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        // A failed check keeps what is shown (a run going on stays shown, and is asked about again in a second).
        if (!res.ok) {
          setCheckError(data.error ?? "The narration could not be checked. Try again in a moment.");
          return;
        }
        const next = data as NarrationSummary;
        // A run that ended by itself (done, a limit, an error) takes Stop away: if Stop had focus, the outcome gets it.
        if (!next.running && stopButton.current && document.activeElement === stopButton.current) focusStatus.current = true;
        if (retryButton.current && document.activeElement === retryButton.current) focusAfterRetry.current = true;
        setCheckError(null);
        setSummary(next);
        if (!voice) setVoice(next.voice);
      })
      .catch(() => {
        if (live) setCheckError("The narration could not be checked. Try again in a moment.");
      })
      .finally(() => {
        if (live) asked.current = 0;
      });
    return () => {
      live = false;
    };
  }, [bookId, voice, tick]);

  // Only an answer about the voice chosen is shown, and sent by Create and Stop. While another voice's answer is all
  // there is (the new voice is being checked, or its check failed), nothing about that other voice is offered.
  const s = summary && (!voice || summary.voice === voice) ? summary : null;
  const isRunning = !!s?.running;

  // While it runs, the count is asked for every second, but a check still on its way is not replaced (on a connection
  // slower than a second every check would be dropped, and the page would stand still): it is waited for, up to 15 s.
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => {
      if (!asked.current || Date.now() - asked.current > 15_000) setTick((x) => x + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  // Keyboard and screen-reader users land on Stop once it is there, and on the outcome once it is gone (after Stop,
  // see stop(); or when the run ends by itself, if Stop had focus).
  useEffect(() => {
    if (isRunning && focusStop.current) {
      focusStop.current = false;
      stopButton.current?.focus();
    } else if (!isRunning && focusStatus.current) {
      focusStatus.current = false;
      status.current?.focus();
    }
  }, [isRunning]);

  // Try again worked, so its button is gone: focus goes to Stop if a run is shown (the lists are locked then), else to the Voice list.
  useEffect(() => {
    if (!checkError && focusAfterRetry.current) {
      focusAfterRetry.current = false;
      (stopButton.current ?? voiceList.current)?.focus();
    }
  }, [checkError]);

  // The voice chosen stays chosen for the next book (the voices are the same for every book).
  const chooseBook = (id: string) => {
    setBookId(id);
    setSummary(null);
    setAgreed(false);
    setCheckError(null);
    setActionError(null);
  };
  const chooseVoice = (id: string) => {
    setVoice(id);
    setAgreed(false);
    setCheckError(null);
    setActionError(null);
  };

  const create = async () => {
    if (!s) return;
    setBusy("starting");
    setActionError(null);
    const res = await fetch(`/api/books/${bookId}/narration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice: s.voice, confirm: agreed }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : null;
    setTick((x) => x + 1);
    setBusy(null);
    setAgreed(false);
    if (!res?.ok) {
      setActionError(data?.error ?? "It could not be started. Try again in a moment.");
      return;
    }
    const next = data as NarrationSummary;
    // Going on: focus moves to Stop once it is there. Over already (a small book, or a limit at once): to the outcome.
    if (next.running) focusStop.current = true;
    setSummary(next);
    if (!next.running) status.current?.focus();
  };

  const stop = async () => {
    if (!s) return;
    setBusy("stopping");
    setActionError(null);
    const res = await fetch(`/api/books/${bookId}/narration?voice=${encodeURIComponent(s.voice)}`, { method: "DELETE" }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : null;
    setTick((x) => x + 1);
    setBusy(null);
    if (!res?.ok) {
      setActionError(data?.error ?? "It could not be stopped. Try again in a moment.");
      return;
    }
    setSummary(data as NarrationSummary);
    status.current?.focus();
  };

  const canMake = s && !s.running && s.saved < s.paragraphs;
  // Create (or Continue) only when the spending limits leave room for at least one more paragraph.
  const room = !!s && (s.stopsAt === null || s.stopsAt > s.saved);
  // While a run is shown (or Create or Stop is on its way), the book and voice stay as they are: its progress and Stop stay in view.
  const locked = isRunning || busy !== null;
  return (
    <div className={styles.narration}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="narrate-book" className={forms.label}>
            Book to narrate
          </label>
          <select
            id="narrate-book"
            className={`${forms.input} ${styles.select}`}
            value={bookId}
            onChange={(e) => chooseBook(e.currentTarget.value)}
            disabled={locked}
          >
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
        {summary ? (
          <div className={styles.field}>
            <label htmlFor="narrate-voice" className={forms.label}>
              Voice
            </label>
            <select
              id="narrate-voice"
              ref={voiceList}
              className={`${forms.input} ${styles.select}`}
              value={voice ?? summary.voice}
              onChange={(e) => chooseVoice(e.currentTarget.value)}
              disabled={locked}
            >
              {summary.voices.map((v) => (
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
            paid for now, not when you listen. Then, in that voice, the whole book plays for free.
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
      {actionError ? (
        <p role="alert" className={forms.error}>
          {actionError}
        </p>
      ) : null}
      {checkError ? (
        <div className={styles.runActions}>
          <p role="alert" className={forms.error}>
            {checkError}
          </p>
          {/* Choosing the same voice again sends no change, so this is the way to ask again. */}
          <button type="button" ref={retryButton} className={styles.quiet} onClick={() => setTick((x) => x + 1)}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
