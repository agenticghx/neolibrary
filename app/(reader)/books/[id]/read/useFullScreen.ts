"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FULL_IDLE_MS, fullEvent, wakesBars } from "./fullscreen";
import { noSubscribe, onFullscreenChange, type ReaderPanel } from "./reader-helpers";
import { setSidebarOpen } from "./sidebar";

/**
 * Full screen in the reader: whether the browser allows it, whether it is on, the switch, and the bars that fade
 * while the reader is still and come back when reached for. Moved out of Reader.tsx as it was (the version 2 split).
 */
export function useFullScreen(props: {
  panel: ReaderPanel;
  setPanel: (panel: ReaderPanel) => void;
  setXrayCard: (entry: string | null) => void;
  /** The sidebar of reading tools is showing. */
  sidebar: boolean;
}) {
  const { panel, setPanel, setXrayCard, sidebar } = props;
  // Full screen (Samuel 2026-10-28: "if I can enjoy Netflix in full screen then I should also enjoy reading in full
  // screen"): the whole page, so the panels and dialogs come along. The button shows only where the browser allows
  // it (not on an iPhone, where Safari keeps full screen for videos), and not on a narrow screen, where the bar is
  // full (it pushed the page 12 px sideways with a note count, CI run on #246). Esc, F or the button leave it.
  const canFull = useSyncExternalStore(noSubscribe, () => document.fullscreenEnabled === true, () => false);
  const full = useSyncExternalStore(onFullscreenChange, () => document.fullscreenElement !== null, () => false);
  const [idle, setIdle] = useState(false);
  const wake = useRef<(e: Event, top?: number) => void>(() => {});
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (document.fullscreenEnabled) {
      // Only the book (Samuel 2026-11-01, "is this how you would watch Netflix?"): an open panel or card closes.
      setPanel("none");
      setXrayCard(null);
      setSidebarOpen(false);
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, [setPanel, setXrayCard]);

  // In full screen only the book is on screen (fullscreen.ts): the bars lie over the page and fade, and come back
  // when the reader reaches for them (the mouse at the top or bottom edge, a tap, a key that is not a page turn), in
  // the page or around it. A panel opened in full screen brings the bars back into their rows until it closes.
  useEffect(() => {
    if (!full || panel !== "none" || sidebar) return;
    let timer = window.setTimeout(() => setIdle(true), FULL_IDLE_MS);
    const wakeUp = (e: Event, top = 0) => {
      const ev = fullEvent(e, top);
      if (!ev || !wakesBars(ev, window.innerHeight)) return;
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), FULL_IDLE_MS);
    };
    wake.current = wakeUp;
    const events = ["pointermove", "pointerdown", "keydown"] as const;
    const onEvent = (e: Event) => wakeUp(e);
    for (const name of events) window.addEventListener(name, onEvent, { passive: true });
    return () => {
      window.clearTimeout(timer);
      wake.current = () => {};
      for (const name of events) window.removeEventListener(name, onEvent);
      setIdle(false);
    };
  }, [full, panel, sidebar]);

  return { canFull, full, idle, wake, toggleFull };
}
