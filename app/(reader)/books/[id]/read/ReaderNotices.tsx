"use client";

import { type RefObject } from "react";
import { type FoliateView } from "./reader-helpers";
import styles from "./reader.module.css";

/**
 * The notices that lie over the page: the book is opening, the reader left off somewhere else, a save failed, the
 * notes could not be loaded, the book could not be opened. Moved out of Reader.tsx as it was (the version 2 split).
 */
export function ReaderNotices(props: {
  status: "loading" | "ready" | "error";
  /** How much of the book has been downloaded so far, while it opens. */
  downloaded: string | null;
  /** A place saved from another device, or by listening, that is not where this page opened. */
  elsewhere: { cfi: string; fraction: number } | null;
  setElsewhere: (place: null) => void;
  /** Places this device itself has saved: one of them is never offered as "elsewhere". */
  ownPlaces: RefObject<Set<string>>;
  view: RefObject<FoliateView | null>;
  notSaved: { reason: string; text: string } | null;
  setNotSaved: (failure: null) => void;
  notesFailed: boolean;
  setNotesFailed: (failed: boolean) => void;
}) {
  const { status, downloaded, elsewhere, setElsewhere, ownPlaces, view, notSaved, setNotSaved, notesFailed, setNotesFailed } = props;
  return (
    <>
      {status === "loading" ? (
        <p className={styles.notice} role="status">
          Opening the book…{downloaded ? ` ${downloaded} downloaded` : ""}
        </p>
      ) : null}
      {elsewhere && status === "ready" ? (
        <div className={styles.elsewhere} role="status">
          <p>You left off at {Math.round(elsewhere.fraction * 100)}% on another device, or while listening.</p>
          <button
            type="button"
            className={styles.primaryTool}
            onClick={() => {
              ownPlaces.current.add(elsewhere.cfi);
              void view.current?.goTo(elsewhere.cfi);
              setElsewhere(null);
            }}
          >
            Go there
          </button>
          <button
            type="button"
            className={styles.tool}
            onClick={() => {
              ownPlaces.current.add(elsewhere.cfi);
              setElsewhere(null);
            }}
          >
            Stay here
          </button>
        </div>
      ) : null}
      {notSaved ? (
        <div className={styles.elsewhere} role="alert" data-testid="save-failed">
          <p>Not saved. The library said: {notSaved.reason}</p>
          {notSaved.text ? <p>Your note: “{notSaved.text}”</p> : null}
          <button type="button" className={styles.tool} onClick={() => setNotSaved(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {notesFailed && status === "ready" ? (
        <div className={styles.elsewhere} role="alert" data-testid="notes-failed">
          <p>Your notes and highlights could not be loaded. They are safe in the library. Reload the page to see them.</p>
          <button type="button" className={styles.tool} onClick={() => setNotesFailed(false)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {status === "error" ? (
        <p className={styles.notice} role="alert">
          This book could not be opened. Go back and try again.
        </p>
      ) : null}
    </>
  );
}
