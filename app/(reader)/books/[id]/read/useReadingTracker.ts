"use client";

import { useCallback, useEffect, useRef } from "react";

/** No input or page turn for this long means the reader has stopped reading. */
export const IDLE_MS = 2 * 60 * 1000;
const FLUSH_MS = 30 * 1000;

const countWords = (text: string) => (text.match(/\S+/g) ?? []).length;

/**
 * Honest reading time (M10): the clock runs only while the tab is visible,
 * something happened in the last two minutes (a page turn, a key, a tap),
 * and reading aloud is not playing (that is listening). Words read are the
 * words on each page seen, counted once per sitting. Running totals go to the
 * server every 30 seconds and when the page is hidden or closed.
 */
export function useReadingTracker(bookId: string, listening: boolean) {
  const state = useRef({
    id: "",
    startedAt: "",
    activeMs: 0,
    pages: new Map<string, number>(),
    lastActivity: 0,
    lastTick: 0,
    lastFlush: 0,
    sent: "",
  });
  const listeningRef = useRef(listening);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  const flush = useCallback(
    (keepalive = false) => {
      const s = state.current;
      if (!s.id) return;
      const words = [...s.pages.values()].reduce((a, b) => a + b, 0);
      const body = JSON.stringify({ sessionId: s.id, startedAt: s.startedAt, activeSeconds: Math.floor(s.activeMs / 1000), words, pages: s.pages.size });
      if (body === s.sent) return;
      s.sent = body;
      void fetch(`/api/books/${bookId}/reading`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive }).catch(() => {
        s.sent = "";
      });
    },
    [bookId],
  );

  useEffect(() => {
    const s = state.current;
    const now = Date.now();
    s.id = crypto.randomUUID();
    s.startedAt = new Date(now).toISOString();
    s.lastActivity = now;
    s.lastTick = now;
    s.lastFlush = now;
    const timer = setInterval(() => {
      const t = Date.now();
      const step = Math.min(t - s.lastTick, 2000);
      s.lastTick = t;
      if (document.visibilityState === "visible" && t - s.lastActivity <= IDLE_MS && !listeningRef.current) s.activeMs += step;
      if (t - s.lastFlush >= FLUSH_MS) {
        s.lastFlush = t;
        flush();
      }
    }, 1000);
    const active = () => {
      s.lastActivity = Date.now();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const leave = () => flush(true);
    window.addEventListener("keydown", active);
    window.addEventListener("pointerdown", active);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", active);
      window.removeEventListener("pointerdown", active);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
      flush(true);
    };
  }, [flush]);

  /** A page was shown: it counts as activity, and its words count once per sitting. */
  const onPage = useCallback((key: string, text: string) => {
    const s = state.current;
    s.lastActivity = Date.now();
    // The same page can be reported again once layout settles; keep its latest count (still one entry per page).
    if (key) s.pages.set(key, countWords(text));
  }, []);

  /** Input inside the book's own frame (keys and taps there do not reach the window). */
  const onActivity = useCallback(() => {
    state.current.lastActivity = Date.now();
  }, []);

  return { onPage, onActivity };
}
