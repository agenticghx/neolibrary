"use client";

import { useSyncExternalStore } from "react";
import styles from "./LibraryViews.module.css";

type View = "carousel" | "spines";
const KEY = "nl.libraryView";

// The chosen view lives on this device (localStorage). When storage is
// blocked (private mode), the choice lasts until the page is left.
let chosen: View | null = null;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function saved(): View {
  if (chosen) return chosen;
  try {
    // An older saved "grid" is the carousel now: the grid view became the carousel (M24, Samuel 2026-10-15).
    return localStorage.getItem(KEY) === "spines" ? "spines" : "carousel";
  } catch {
    return "carousel";
  }
}
function choose(view: View) {
  chosen = view;
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // Remembering is a convenience; the switch still works.
  }
  listeners.forEach((l) => l());
}

/**
 * The View switch (D8, Samuel 2026-10-05: a button to switch to spines on
 * desktop and phone; 2026-10-15: the grid became the book carousel, which is
 * the default), remembered on this device. Both
 * views are drawn by the server; the one not shown is `hidden`, so it is not
 * in the accessibility tree twice.
 */
export function LibraryViews({
  header,
  between,
  carousel,
  spines,
}: {
  header: React.ReactNode;
  /** Shown between the heading row and the books (Home's import hint). */
  between?: React.ReactNode;
  carousel: React.ReactNode;
  spines: React.ReactNode;
}) {
  const view = useSyncExternalStore(subscribe, saved, () => "carousel" as View);
  return (
    <>
      <div className={styles.head}>
        {header}
        <div role="group" aria-label="Library view" className={styles.switch}>
          <button type="button" aria-pressed={view === "carousel"} className={styles.option} onClick={() => choose("carousel")}>
            Carousel
          </button>
          <button type="button" aria-pressed={view === "spines"} className={styles.option} onClick={() => choose("spines")}>
            Spines
          </button>
        </div>
      </div>
      {between}
      <div hidden={view !== "carousel"}>{carousel}</div>
      <div hidden={view !== "spines"}>{spines}</div>
    </>
  );
}
