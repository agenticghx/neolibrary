"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clearSession as clearFocusSession, DEFAULT_WAIT_MINUTES, type FocusSession, fromServer as focusFromServer, isOver as focusIsOver, loadSession as loadFocusSession, saveSession as saveFocusSession, type ServerFocus } from "@/lib/reader/focus-session";
import { api } from "./reader-helpers";

/**
 * A focus session at one sitting (M26 R3, R4): the reader writes the question they are reading to answer, sets a
 * timer, and sees only the page until the time is up or they answer. This holds the session, keeps it level with the
 * server (which decides every ending), and starts, ends, waits and answers. Moved out of Reader.tsx as it was (the
 * version 2 split). The whole-book focus (M26 R5) is useBookFocus.ts.
 */
export function useSittingFocus(props: {
  bookId: string;
  /** A visitor has no focus sessions: the server is never asked. */
  visitor?: boolean;
  /** Closes whichever panel is open, when a session starts. */
  closePanels: () => void;
  /** Loads the book's notes again: an answer is saved as a note. */
  reload: () => Promise<void>;
}) {
  // A focus session with a question (M26 R3). Since R4a it lives on the server; this device keeps a copy, so a
  // reload part-way through, or a moment offline, picks it up with the time that is left.
  const [focusSession, setFocusSession] = useState<FocusSession | null>(null);
  const [focusStart, setFocusStart] = useState(false);
  const [focusEnding, setFocusEnding] = useState(false);
  // Leave early… (M26 R4b): the dialog with the two ways out, and how long the server's wait lasts.
  const [focusLeaving, setFocusLeaving] = useState(false);
  const [focusWaitMinutes, setFocusWaitMinutes] = useState(DEFAULT_WAIT_MINUTES);
  // The session just ended with its answer saved: the sitting still reports it once more, now with the note's id.
  const [focusDone, setFocusDone] = useState<{ id: string; question: string; answerAnnotationId: string } | null>(null);
  // The time is up, or the wait to leave early has run out: ask "Did you answer it?" (checked once a second, so
  // page.clock drives it in tests).
  useEffect(() => {
    if (!focusSession || focusEnding) return;
    const timer = setInterval(() => {
      if (focusIsOver(focusSession)) {
        setFocusLeaving(false);
        setFocusEnding(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [focusSession, focusEnding]);
  const focusReport = useMemo(
    () => (focusSession ? { id: focusSession.id, question: focusSession.question, answerAnnotationId: null } : focusDone),
    [focusSession, focusDone],
  );

  /**
   * The focus session as the server has it (M26 R4a), put on this device: it may have been started or ended, or a
   * wait begun or cancelled, on another device (M26 R4b). Offline, this device's copy stands. `trustServer` drops
   * this device's own end time: after the server refused to end the session, this device's clock was ahead.
   */
  const syncFocus = useCallback(
    async (trustServer = false) => {
      const local = loadFocusSession(props.bookId);
      let session = local;
      try {
        const res = await fetch("/api/focus", { cache: "no-store" });
        if (res.ok) {
          const open = ((await res.json()) as { session: (ServerFocus & { waitMs?: number }) | null }).session;
          // A whole-book focus (M26 R5) is not a sitting: useBookFocus shows it.
          const sitting = open && (open as { kind?: string }).kind !== "book" ? open : null;
          session = sitting && sitting.bookId === props.bookId ? focusFromServer(sitting, trustServer ? null : local) : null;
          if (open?.waitMs) setFocusWaitMinutes(open.waitMs / 60_000);
        }
      } catch {
        // Offline: the copy on this device runs the timer.
      }
      return { session, local };
    },
    [props.bookId],
  );
  const showFocus = useCallback((session: FocusSession | null, hadLocal: boolean) => {
    if (session) {
      saveFocusSession(session);
      setFocusSession(session);
      setFocusEnding(focusIsOver(session));
      if (focusIsOver(session)) setFocusLeaving(false);
    } else {
      if (hadLocal) clearFocusSession();
      setFocusSession(null);
      setFocusEnding(false);
      setFocusLeaving(false);
    }
  }, []);

  // A focus session on this book picks up where it was, with the time that is left (M26 R4a), and again each time
  // this tab comes back to the front.
  useEffect(() => {
    if (props.visitor) return; // a visitor has no focus sessions
    let cancelled = false;
    const sync = async () => {
      if (document.visibilityState !== "visible") return;
      const { session, local } = await syncFocus();
      if (!cancelled) showFocus(session, Boolean(local));
    };
    void sync();
    const onVisible = () => void sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncFocus, showFocus, props.visitor]);
  /** Starts the session on the server (one at a time: it refuses a second); throws its reason for the dialog. */
  const beginFocus = async (question: string, minutes: number) => {
    const { session: started } = (await api("/api/focus", "POST", { bookId: props.bookId, question, minutes })) as { session: ServerFocus & { waitMs?: number } };
    const session = focusFromServer(started, null);
    if (started.waitMs) setFocusWaitMinutes(started.waitMs / 60_000);
    saveFocusSession(session);
    setFocusDone(null);
    setFocusEnding(false);
    setFocusSession(session);
    setFocusStart(false);
    props.closePanels();
  };

  /**
   * The session is over, with or without an answer. Without one, the server is told here (saving an answer ends it
   * there), and may refuse: this device's clock ran ahead, so the strip comes back with the time the server says is
   * left. Offline, this device lets go; the server stops locking at the same moment by its own clock.
   */
  const finishFocus = async (answered = false) => {
    if (focusSession && !answered) {
      const res = await fetch("/api/focus/end", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: focusSession.id }) }).catch(() => null);
      if (res?.status === 409) {
        const { session } = await syncFocus(true);
        if (session) return showFocus(session, true);
      }
    }
    clearFocusSession();
    setFocusEnding(false);
    setFocusLeaving(false);
    setFocusSession(null);
  };

  /** Leave early…: the wait (M26 R4b), started or cancelled on the server, so a reload or another device keeps it. */
  const focusWait = async (method: "POST" | "DELETE") => {
    if (!focusSession) return;
    const { session } = (await api("/api/focus/wait", method, { id: focusSession.id })) as { session: ServerFocus };
    const next = focusFromServer(session, focusSession);
    saveFocusSession(next);
    setFocusSession(next);
    setFocusLeaving(false);
  };

  /** The answer is saved as a note on the book (the reader's own, never overwritten), and the sittings point at it. */
  const answerFocus = async (answer: string) => {
    if (!focusSession) return;
    const { note } = await api(`/api/books/${props.bookId}/focus`, "POST", {
      focusId: focusSession.id,
      noteId: focusSession.noteId,
      question: focusSession.question,
      answer,
    });
    // One last report with the note's id, after the session goes.
    setFocusDone({ id: focusSession.id, question: focusSession.question, answerAnnotationId: note.id });
    await finishFocus(true);
    await props.reload();
  };

  return { focusSession, focusStart, setFocusStart, focusEnding, focusLeaving, setFocusLeaving, focusWaitMinutes, focusReport, beginFocus, finishFocus, focusWait, answerFocus };
}
