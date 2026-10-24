"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  cleanDays,
  cleanMinutes,
  cleanQuestion,
  countWords,
  DEFAULT_BOOK_DAYS,
  DEFAULT_MINUTES,
  describeRemaining,
  EARLY_ANSWER_WORDS,
  type FocusSession,
  formatRemaining,
  isOver,
  MAX_BOOK_DAYS,
  MAX_MINUTES,
  MIN_MINUTES,
  remainingMs,
  waitRemainingMs,
} from "@/lib/reader/focus-session";
import own from "./FocusSession.module.css";
import styles from "./reader.module.css";

/**
 * A focus session with a question (M26 R3). Four pieces, drawn by Reader.tsx:
 * - StartFocusDialog: the question and the timer, before anything is hidden;
 * - FocusStrip: in the top bar's place while the session runs: the question, the time left, and Leave early…
 *   (M26 R4b); while a wait to leave runs, "Leaving in 9:12" and Keep reading;
 * - LeaveFocusDialog: the two ways out before the time is up: an answer of 40 words, or the wait;
 * - EndFocusDialog: "Did you answer it?" when the time is up or the wait has run out: the answer, saved as a note.
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

/**
 * Before the session: the question to answer and how long to read for. A sitting (minutes, only the page) or, since
 * M26 R5, the whole book (days: other books stay closed, and this one reads as usual).
 */
export function StartFocusDialog({
  open,
  onStart,
  onStartBook,
  onCancel,
}: {
  open: boolean;
  /** Starts it on the server; a refusal (another session running, no network) is thrown and shown here. */
  onStart: (question: string, minutes: number) => Promise<void>;
  onStartBook: (question: string, days: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<"sitting" | "book">("sitting");
  const [question, setQuestion] = useState("");
  const [minutes, setMinutes] = useState(String(DEFAULT_MINUTES));
  const [days, setDays] = useState(String(DEFAULT_BOOK_DAYS));
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const cancel = () => {
    setProblem("");
    onCancel();
  };
  return (
    <Modal open={open} label="Start a focus session" first={box} onCancel={cancel} testId="focus-start">
      <form
        className={own.form}
        onSubmit={async (e) => {
          e.preventDefault();
          const q = cleanQuestion(question);
          if (!q) return setProblem(kind === "book" ? "Write the question you are reading this book to answer." : "Write the question you are reading to answer.");
          const m = kind === "book" ? cleanDays(days) : cleanMinutes(minutes);
          if (!m) return setProblem(kind === "book" ? `Set between 1 and ${MAX_BOOK_DAYS} days.` : `Set between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`);
          setProblem("");
          setBusy(true);
          try {
            await (kind === "book" ? onStartBook(q, m) : onStart(q, m));
            setQuestion("");
          } catch (err) {
            setProblem(err instanceof Error && err.message ? err.message : "The session could not start. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className={styles.panelTitle}>Focus session</h2>
        <fieldset className={own.kinds}>
          <legend className={styles.groupLabel}>For</legend>
          <label className={own.kind}>
            <input type="radio" name="focus-kind" value="sitting" checked={kind === "sitting"} onChange={() => setKind("sitting")} />
            This sitting
          </label>
          <label className={own.kind}>
            <input type="radio" name="focus-kind" value="book" checked={kind === "book"} onChange={() => setKind("book")} />
            The whole book
          </label>
        </fieldset>
        <p className={own.lede}>
          {kind === "book"
            ? "Only this book opens until you reach its last page or the days run out. It reads as usual. At the end you write what you found."
            : "Everything but the page goes away until the time is up. Then you write what you found."}
        </p>
        <label htmlFor="focus-question" className={styles.groupLabel}>
          {kind === "book" ? "What are you reading this book to answer?" : "What are you reading to answer?"}
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
        {kind === "book" ? (
          <>
            <label htmlFor="focus-days" className={styles.groupLabel}>
              Days (up to {MAX_BOOK_DAYS})
            </label>
            <input
              id="focus-days"
              className={own.minutes}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_BOOK_DAYS}
              step={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </>
        ) : (
          <>
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
          </>
        )}
        <PhoneLock />
        {problem ? (
          <p className={styles.formError} role="alert">
            {problem}
          </p>
        ) : null}
        <div className={own.actions}>
          <button type="button" className={styles.tool} onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className={styles.primaryTool} disabled={busy}>
            Start
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * In the top bar's place while the session runs. The clock is read once a second (so page.clock drives it in tests).
 * While a wait to leave early runs, the strip says so, and Keep reading cancels it.
 */
export function FocusStrip({ session, onLeave, onStay }: { session: FocusSession; onLeave: () => void; onStay: () => Promise<void> }) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session]);
  const left = remainingMs(session, now);
  const wait = waitRemainingMs(session, now);
  return (
    <div className={own.strip} data-testid="focus-strip">
      <p className={own.stripQuestion} title={session.question}>
        {session.question}
      </p>
      {wait === null ? (
        <>
          <p className={own.clock} role="timer" aria-label={describeRemaining(left)} data-testid="focus-clock">
            <span aria-hidden="true">{formatRemaining(left)}</span>
          </p>
          <button type="button" className={styles.tool} onClick={onLeave}>
            Leave early…
          </button>
        </>
      ) : (
        <>
          <p className={own.clock} role="timer" aria-label={`Leaving in ${describeRemaining(wait).replace(/ left$/, "")}`} data-testid="focus-wait">
            <span aria-hidden="true">Leaving in {formatRemaining(wait)}</span>
          </p>
          <button
            type="button"
            className={styles.tool}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onStay();
              } catch {
                // Offline: the wait goes on, here and on the server; the strip stays as it is.
              } finally {
                setBusy(false);
              }
            }}
          >
            Keep reading
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Leave early… (M26 R4b): the two ways out before the time is up. Writing an answer of at least 40 words ends the
 * session at once (the Save button stays off until then); the wait (10 minutes) lets the reader go when it runs
 * out, and the page stays readable meanwhile. Escape, or Keep reading, closes this and changes nothing.
 */
export function LeaveFocusDialog({
  session,
  open,
  waitMinutes,
  minWords = EARLY_ANSWER_WORDS,
  testId = "focus-leave",
  onAnswer,
  onWait,
  onCancel,
}: {
  testId?: string;
  session: FocusSession | null;
  open: boolean;
  waitMinutes: number;
  /** The words an early answer needs: 40 for a sitting, 150 for a whole book (M26 R5). */
  minWords?: number;
  onAnswer: (answer: string) => Promise<void>;
  onWait: () => Promise<void>;
  onCancel: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const words = countWords(answer);
  const enough = words >= minWords;
  // Two of these dialogs live in the reader (a sitting's and a whole book's), so their ids are made unique.
  const answerId = useId();
  const countId = useId();
  const run = async (step: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setProblem("");
    try {
      await step();
    } catch (err) {
      setProblem(err instanceof Error && err.message ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    setProblem("");
    onCancel();
  };
  // "10-minute" and "10 minutes", "24-hour" and "24 hours"; the browser tests shorten the wait to seconds.
  const [n, unit] =
    waitMinutes >= 60 && waitMinutes % 60 === 0
      ? [waitMinutes / 60, "hour"]
      : waitMinutes >= 1
        ? [Math.round(waitMinutes), "minute"]
        : [Math.round(waitMinutes * 60), "second"];
  const wait = `${n}-${unit}`;
  const waitLong = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return (
    <Modal open={open} label="Leave early" first={box} onCancel={cancel} testId={testId}>
      <form
        className={own.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (enough) void run(() => onAnswer(answer.trim()), "The answer could not be saved. Try again.");
        }}
      >
        <h2 className={styles.panelTitle}>Leave early?</h2>
        <blockquote className={own.asked}>{session?.question}</blockquote>
        <p className={own.lede}>Write your answer now, at least {minWords} words, and the session ends. Or start the wait and keep reading until it runs out.</p>
        <label htmlFor={answerId} className={styles.groupLabel}>
          Your answer
        </label>
        <textarea
          ref={box}
          id={answerId}
          className={own.question}
          rows={5}
          maxLength={4000}
          value={answer}
          aria-describedby={countId}
          placeholder="In your own words. It is saved as a note on this book, and comes back in Daily review."
          onChange={(e) => setAnswer(e.target.value)}
        />
        <p id={countId} className={`${own.count} ${enough ? own.countDone : ""}`} aria-live="polite" data-testid="focus-leave-count">
          {words} of {minWords} words
        </p>
        {problem ? (
          <p className={styles.formError} role="alert">
            {problem}
          </p>
        ) : null}
        <div className={own.actions}>
          <button type="submit" className={styles.primaryTool} disabled={busy || !enough}>
            {busy ? "Saving…" : "Save the answer and leave"}
          </button>
        </div>
        <div className={own.or}>
          <p className={own.lede}>Or wait {waitLong}. You can keep reading meanwhile, and stop the wait at any time.</p>
          <div className={own.actions}>
            <button type="button" className={styles.tool} onClick={cancel}>
              Keep reading
            </button>
            <button type="button" className={styles.tool} disabled={busy} onClick={() => void run(onWait, "The wait could not start. Try again.")}>
              Start the {wait} wait
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/**
 * How to lock the phone itself to this page (M26 R4b). A web page cannot do it; the phone can. This only explains:
 * the app changes no setting.
 */
function PhoneLock() {
  return (
    <details className={own.phoneLock}>
      <summary>Lock this phone to the page too</summary>
      <p>A web page cannot stop you opening another app. Your phone can, if you turn it on. This app changes no setting.</p>
      <h3>iPhone or iPad: Guided Access</h3>
      <ol>
        <li>In Settings, open Accessibility, then Guided Access: turn it on, and set a passcode. Let someone you trust choose it.</li>
        <li>Back here, press the side button (or the Home button) three times, then tap Start.</li>
        <li>To stop, press it three times again and type the passcode.</li>
      </ol>
      <h3>Android: app pinning</h3>
      <ol>
        <li>In Settings, open Security (on some phones, Security and privacy, then More security settings), then App pinning: turn it on, with “Ask for PIN before unpinning”.</li>
        <li>Open the recent apps, tap the browser’s icon at the top of its card, then tap Pin.</li>
        <li>To unpin, swipe up and hold (or hold Back and Overview), then type your PIN.</li>
      </ol>
    </details>
  );
}

/**
 * When the time is up or the wait has run out: the question again, and a box for the answer. Save keeps it as a
 * note on the book; "No answer yet" ends the session with nothing saved (the sitting still keeps its question).
 */
export function EndFocusDialog({
  session,
  open,
  heading,
  testId = "focus-end",
  onSave,
  onSkip,
}: {
  testId?: string;
  session: FocusSession | null;
  open: boolean;
  /** Said instead of the usual heading: "You reached the end. Did you answer it?" for a whole book (M26 R5). */
  heading?: string;
  onSave: (answer: string) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // Reader.tsx keys this dialog by the session's id, so each session starts with an empty box. Two live in the reader
  // (a sitting's and a whole book's), so the box's id is made unique.
  const answerId = useId();
  const timeUp = session ? remainingMs(session) === 0 : true;
  const waited = session ? !timeUp && isOver(session) : false;
  return (
    <Modal open={open} label="Did you answer it?" first={box} testId={testId}>
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
        <h2 className={styles.panelTitle}>{heading ?? (timeUp ? "Time's up. Did you answer it?" : waited ? "The wait is over. Did you answer it?" : "Did you answer it?")}</h2>
        <blockquote className={own.asked}>{session?.question}</blockquote>
        <label htmlFor={answerId} className={styles.groupLabel}>
          Your answer
        </label>
        <textarea
          ref={box}
          id={answerId}
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
          <button
            type="button"
            className={styles.tool}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setProblem("");
              try {
                await onSkip();
              } catch (err) {
                setProblem(err instanceof Error && err.message ? err.message : "The session could not end. Try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
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

/** "23:59:12" or "9:05": hours, minutes and seconds left in a whole-book focus's 24-hour wait. */
export function formatLongRemaining(ms: number) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : formatRemaining(ms);
}

/**
 * Whole-book focus (M26 R5): one line above the page while it runs: the book's question, until when, and Leave
 * early…; while a wait to leave runs, how long is left of it and Keep reading. The reader is otherwise as usual.
 */
export function BookFocusLine({ session, onLeave, onStay }: { session: FocusSession; onLeave: () => void; onStay: () => Promise<void> }) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session]);
  const wait = waitRemainingMs(session, now);
  const until = new Date(session.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  return (
    <section className={own.bookLine} aria-label="Whole-book focus" data-testid="book-focus">
      <p className={own.stripQuestion} title={session.question}>
        {session.question}
      </p>
      {wait === null ? (
        <>
          <p className={own.until}>Only this book until {until}</p>
          <button type="button" className={styles.tool} onClick={onLeave}>
            Leave early…
          </button>
        </>
      ) : (
        <>
          <p className={own.until} role="timer" data-testid="book-focus-wait">
            Leaving in {formatLongRemaining(wait)}
          </p>
          <button
            type="button"
            className={styles.tool}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onStay();
              } catch {
                // Offline: the wait goes on, here and on the server.
              } finally {
                setBusy(false);
              }
            }}
          >
            Keep reading
          </button>
        </>
      )}
    </section>
  );
}
