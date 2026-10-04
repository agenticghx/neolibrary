"use client";

import { useCallback, useEffect, useRef } from "react";

/** No input or page turn for this long means the reader has stopped reading. */
export const IDLE_MS = 2 * 60 * 1000;
const FLUSH_MS = 30 * 1000;
/** A page reported this soon after the last one, with no key or tap between, is the same page re-laid out. */
const SETTLE_MS = 1500;

const countWords = (text: string) => (text.match(/\S+/g) ?? []).length;

/** The chapter a page belongs to: its link in the contents, its title, and how far into the book it is (0 to 1). */
export type PageChapter = { key: string; label: string; position: number };

type ChapterTally = { label: string; position: number; activeMs: number; pages: Map<string, number> };

/**
 * Honest reading time (M10): the clock runs only while the tab is visible,
 * something happened in the last two minutes (a page turn, a key, a tap),
 * and reading aloud is not playing (that is listening). Words read are the
 * words on each page seen, counted once per sitting. Time and words are also
 * split by the chapter on screen (for per-chapter speed). Running totals go to
 * the server every 30 seconds and when the page is hidden or closed.
 */
export function useReadingTracker(bookId: string, listening: boolean) {
  const state = useRef({
    id: "",
    startedAt: "",
    activeMs: 0,
    pages: new Map<string, number>(),
    chapters: new Map<string, ChapterTally>(),
    chapter: "",
    lastPage: "",
    lastPageAt: 0,
    inputSincePage: false,
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
      const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
      const chapters = [...s.chapters].map(([key, c]) => ({
        key,
        label: c.label,
        position: c.position,
        activeSeconds: Math.floor(c.activeMs / 1000),
        words: sum(c.pages),
      }));
      const body = JSON.stringify({ sessionId: s.id, startedAt: s.startedAt, activeSeconds: Math.floor(s.activeMs / 1000), words, pages: s.pages.size, chapters });
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
      if (document.visibilityState === "visible" && t - s.lastActivity <= IDLE_MS && !listeningRef.current) {
        s.activeMs += step;
        const chapter = s.chapters.get(s.chapter);
        if (chapter) chapter.activeMs += step;
      }
      if (t - s.lastFlush >= FLUSH_MS) {
        s.lastFlush = t;
        flush();
      }
    }, 1000);
    const active = () => {
      s.lastActivity = Date.now();
      s.inputSincePage = true;
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
  const onPage = useCallback((key: string, text: string, chapter?: PageChapter) => {
    const s = state.current;
    s.lastActivity = Date.now();
    if (!key) return;
    // The same page can be reported again once layout settles, sometimes at a
    // slightly different start: with no input since a report moments ago, the
    // new report replaces it. Otherwise keep each page's latest count.
    const now = Date.now();
    if (s.lastPage && s.lastPage !== key && !s.inputSincePage && now - s.lastPageAt < SETTLE_MS) {
      s.pages.delete(s.lastPage);
      for (const c of s.chapters.values()) c.pages.delete(s.lastPage);
    }
    s.lastPage = key;
    s.lastPageAt = now;
    s.inputSincePage = false;
    const words = countWords(text);
    s.pages.set(key, words);
    s.chapter = chapter?.key ?? "";
    if (!chapter?.key) return;
    const c = s.chapters.get(chapter.key) ?? { label: chapter.label, position: chapter.position, activeMs: 0, pages: new Map<string, number>() };
    c.position = Math.min(c.position, chapter.position);
    c.pages.set(key, words);
    s.chapters.set(chapter.key, c);
  }, []);

  /** Input inside the book's own frame (keys and taps there do not reach the window). */
  const onActivity = useCallback(() => {
    state.current.lastActivity = Date.now();
    state.current.inputSincePage = true;
  }, []);

  return { onPage, onActivity };
}
