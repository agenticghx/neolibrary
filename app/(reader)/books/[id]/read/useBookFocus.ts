"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  answerWordsFor,
  DEFAULT_BOOK_WAIT_HOURS,
  FINISHED_AT,
  type FocusSession,
  fromServer,
  isOver,
  remainingMs,
  type ServerFocus,
} from "@/lib/reader/focus-session";

/** What GET /api/focus says about a whole-book focus (M26 R5). */
type ServerBookFocus = ServerFocus & { kind: string; bookIds?: string[]; finished?: boolean; running: boolean; waitMs?: number };

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? "Not saved"), { status: res.status });
  return data;
}

/**
 * Whole-book focus (M26 R5) in the reader: one book only, for days. Kept apart from Reader.tsx's sitting session
 * (R3/R4), which hides everything but the page; here the reader reads as usual, with one line above the page.
 * The server decides every ending, as for a sitting: when the days run out, when a wait to leave early runs out,
 * when an early answer is long enough (150 words), and when the reader has reached the last page (the place this
 * reader saves; it is saved here first, so the server sees it).
 */
export function useBookFocus(bookId: string, where: { cfi: string | null; fraction: number }, onAnswered: () => void) {
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [finished, setFinished] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [waitMinutes, setWaitMinutes] = useState(DEFAULT_BOOK_WAIT_HOURS * 60);
  const focusRef = useRef<FocusSession | null>(null);

  /** The book focus as the server has it, put on this page; null when none runs on this book (either edition). */
  const show = useCallback(
    (open: ServerBookFocus | null) => {
      if (!open || open.kind !== "book" || !(open.bookIds ?? [open.bookId]).includes(bookId)) {
        focusRef.current = null;
        setFocus(null);
        setEnding(false);
        setLeaving(false);
        setFinished(false);
        return;
      }
      const next = fromServer(open, focusRef.current);
      focusRef.current = next;
      setFocus(next);
      if (open.waitMs) setWaitMinutes(open.waitMs / 60_000);
      setFinished(Boolean(open.finished));
      if (open.finished || !open.running) {
        setLeaving(false);
        setEnding(true);
      }
    },
    [bookId],
  );

  const sync = useCallback(async () => {
    try {
      const { session } = (await (await fetch("/api/focus", { cache: "no-store" })).json()) as { session: ServerBookFocus | null };
      show(session);
    } catch {
      // Offline: the line stays as it is.
    }
  }, [show]);

  // On opening the book, and each time this tab comes back to the front (it may have changed on another device).
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { session } = (await (await fetch("/api/focus", { cache: "no-store" })).json()) as { session: ServerBookFocus | null };
        if (!cancelled) show(session);
      } catch {
        // Offline: the line stays as it is.
      }
    };
    void check();
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [show]);

  // The days have run out, or the wait to leave early: ask the server (checked once a second).
  useEffect(() => {
    if (!focus || ending) return;
    const timer = setInterval(() => {
      if (isOver(focus)) void sync();
    }, 1000);
    return () => clearInterval(timer);
  }, [focus, ending, sync]);

  // The last page: save the place first, so the server sees it, then ask. Once per place.
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || ending || !where.cfi || where.fraction < FINISHED_AT || asked.current === where.cfi) return;
    asked.current = where.cfi;
    void (async () => {
      await fetch(`/api/books/${bookId}/position`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cfi: where.cfi, fraction: where.fraction }),
      }).catch(() => null);
      await sync();
    })();
  }, [focus, ending, where.cfi, where.fraction, bookId, sync]);

  const start = async (question: string, days: number) => {
    const { session } = await send("/api/focus", "POST", { bookId, question, kind: "book", days });
    focusRef.current = null;
    show(session);
  };

  /** Leave early…: the wait (24 hours), started or cancelled on the server. */
  const wait = async (method: "POST" | "DELETE") => {
    if (!focus) return;
    const { session } = await send("/api/focus/wait", method, { id: focus.id });
    show(session);
    setLeaving(false);
  };

  /** An answer: early (150 words or more), or at the end. Saved as a note on the book; the server ends the focus. */
  const answer = async (text: string) => {
    if (!focus) return;
    await send(`/api/books/${bookId}/focus`, "POST", { focusId: focus.id, noteId: focus.noteId, question: focus.question, answer: text });
    show(null);
    onAnswered();
  };

  /** "No answer yet" at the end. Refused while the focus still runs (this device's clock ran ahead): shown again. */
  const skip = async () => {
    if (!focus) return;
    try {
      await send("/api/focus/end", "POST", { id: focus.id });
      show(null);
    } catch (e) {
      if ((e as { status?: number }).status !== 409) throw e;
      setEnding(false);
      await sync();
    }
  };

  const heading = !focus
    ? undefined
    : finished
      ? "You reached the end. Did you answer it?"
      : remainingMs(focus) === 0
        ? "The days are up. Did you answer it?"
        : undefined;

  return { focus, leaving, setLeaving, ending, heading, waitMinutes, minWords: answerWordsFor("book"), start, wait, answer, skip };
}
