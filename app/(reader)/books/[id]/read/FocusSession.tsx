"use client";

import { useEffect, useRef, useState } from "react";
import {
  cleanMinutes,
  cleanQuestion,
  DEFAULT_MINUTES,
  describeRemaining,
  type FocusSession,
  formatRemaining,
  isOver,
  MAX_MINUTES,
  MIN_MINUTES,
  remainingMs,
} from "@/lib/reader/focus-session";
import own from "./FocusSession.module.css";
import styles from "./reader.module.css";

/**
 * A focus session with a question (M26 R3). Three pieces, drawn by Reader.tsx:
 * - StartFocusDialog: the question and the timer, before anything is hidden;
 * - FocusStrip: in the top bar's place while the session runs: the question, the time left, and End now;
 * - EndFocusDialog: "Did you answer it?" when the time is up (or End now): the answer, saved as a note on the book.
 * The rule for all of M26 holds: the reader writes first. Nothing here shows the AI's view of anything.
 */

/** The element that has the keyboard, looking inside the book viewer (its frames sit in shadow roots). */
function deepActive(): HTMLElement | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/**
 * A modal dialog (as ShortcutsDialog): the rest of the reader cannot be reached while it is open, Tab goes round
 * inside it, and the keyboard goes back to where it was when it closes. `onCancel` is what Escape and the phone's
 * back gesture do: nothing, for a dialog that must be answered.
 */
function Modal({
  open,
  label,
  first,
  onCancel,
  children,
  testId,
}: {
  open: boolean;
  label: string;
  first: React.RefObject<HTMLElement | null>;
  onCancel?: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      back.current = deepActive();
      d.showModal();
      first.current?.focus();
    } else if (!open && d.open) {
      d.close();
      const to = back.current;
      back.current = null;
      if (to?.isConnected) to.focus({ preventScroll: true });
    }
  }, [open, first]);
  return (
    <dialog
      ref={dialog}
      className={`${styles.shortcuts} ${own.dialog}`}
      aria-modal="true"
      aria-label={label}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel?.();
      }}
      onKeyDown={(e) => {
        // The reader's own keys (page turns, Escape for panels) wait while a dialog is open.
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel?.();
          return;
        }
        if (e.key !== "Tab") return;
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input, textarea, [href]"));
        const firstItem = items[0];
        const last = items.at(-1);
        if (!firstItem || !last) return;
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          firstItem.focus();
        }
      }}
    >
      {children}
    </dialog>
  );
}

/** Before the session: the question to answer and how long to read for. */
export function StartFocusDialog({ open, onStart, onCancel }: { open: boolean; onStart: (question: string, minutes: number) => void; onCancel: () => void }) {
  const [question, setQuestion] = useState("");
  const [minutes, setMinutes] = useState(String(DEFAULT_MINUTES));
  const [problem, setProblem] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const cancel = () => {
    setProblem("");
    onCancel();
  };
  return (
    <Modal open={open} label="Start a focus session" first={box} onCancel={cancel} testId="focus-start">
      <form
        className={own.form}
        onSubmit={(e) => {
          e.preventDefault();
          const q = cleanQuestion(question);
          const m = cleanMinutes(minutes);
          if (!q) return setProblem("Write the question you are reading to answer.");
          if (!m) return setProblem(`Set between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`);
          setProblem("");
          onStart(q, m);
          setQuestion("");
        }}
      >
        <h2 className={styles.panelTitle}>Focus session</h2>
        <p className={own.lede}>Everything but the page goes away until the time is up. Then you write what you found.</p>
        <label htmlFor="focus-question" className={styles.groupLabel}>
          What are you reading to answer?
        </label>
        <textarea
          ref={box}
          id="focus-question"
          className={own.question}
          rows={3}
          maxLength={500}
          value={question}
          placeholder="One question, in your own words."
          onChange={(e) => setQuestion(e.target.value)}
        />
        <label htmlFor="focus-minutes" className={styles.groupLabel}>
          Minutes
        </label>
        <input
          id="focus-minutes"
          className={own.minutes}
          type="number"
          inputMode="numeric"
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          step={1}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        {problem ? (
          <p className={styles.formError} role="alert">
            {problem}
          </p>
        ) : null}
        <div className={own.actions}>
          <button type="button" className={styles.tool} onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryTool}>
            Start
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** In the top bar's place while the session runs. The clock is read once a second (so page.clock drives it in tests). */
export function FocusStrip({ session, onEnd }: { session: FocusSession; onEnd: () => void }) {
  const [left, setLeft] = useState(() => remainingMs(session));
  useEffect(() => {
    const tick = () => setLeft(remainingMs(session));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session]);
  return (
    <div className={own.strip} data-testid="focus-strip">
      <p className={own.stripQuestion} title={session.question}>
        {session.question}
      </p>
      <p className={own.clock} role="timer" aria-label={describeRemaining(left)} data-testid="focus-clock">
        <span aria-hidden="true">{formatRemaining(left)}</span>
      </p>
      <button type="button" className={styles.tool} onClick={onEnd}>
        End now
      </button>
    </div>
  );
}

/**
 * When the time is up (or End now): the question again, and a box for the answer. Save keeps it as a note on the
 * book; "No answer yet" ends the session with nothing saved (the sitting still keeps its question).
 */
export function EndFocusDialog({
  session,
  open,
  onSave,
  onSkip,
}: {
  session: FocusSession | null;
  open: boolean;
  onSave: (answer: string) => Promise<void>;
  onSkip: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // Reader.tsx keys this dialog by the session's id, so each session starts with an empty box.
  const over = session ? isOver(session) : true;
  return (
    <Modal open={open} label="Did you answer it?" first={box} testId="focus-end">
      <form
        className={own.form}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!answer.trim()) return setProblem("Write your answer, or choose No answer yet.");
          setBusy(true);
          setProblem("");
          try {
            await onSave(answer.trim());
          } catch (err) {
            setProblem(err instanceof Error && err.message ? err.message : "The answer could not be saved. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className={styles.panelTitle}>{over ? "Time's up. Did you answer it?" : "Did you answer it?"}</h2>
        <blockquote className={own.asked}>{session?.question}</blockquote>
        <label htmlFor="focus-answer" className={styles.groupLabel}>
          Your answer
        </label>
        <textarea
          ref={box}
          id="focus-answer"
          className={own.question}
          rows={5}
          maxLength={4000}
          value={answer}
          placeholder="In your own words. It is saved as a note on this book, and comes back in Daily review."
          onChange={(e) => setAnswer(e.target.value)}
        />
        {problem ? (
          <p className={styles.formError} role="alert">
            {problem}
          </p>
        ) : null}
        <div className={own.actions}>
          <button type="button" className={styles.tool} disabled={busy} onClick={onSkip}>
            No answer yet
          </button>
          <button type="submit" className={styles.primaryTool} disabled={busy}>
            {busy ? "Saving…" : "Save the answer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
