"use client";

import { type RefObject } from "react";
import type { Annotation } from "@/lib/library/annotations";
import { type ReaderPanel } from "./reader-helpers";
import { type RewrittenMode } from "./settings";
import styles from "./reader.module.css";

/**
 * The reader's sidebar of reading tools: Notes, Study, Rewritten, Names, Bookmark and Focus. On a phone it is a row
 * under the book. Moved out of Reader.tsx as it was (the version 2 split): it shows the tools and reports each tap.
 */
export function ReaderRail(props: {
  /** The sidebar's element: the reader measures it, to keep panels above it on a phone. */
  rail: RefObject<HTMLElement | null>;
  /** A visitor gets Study and Rewritten only (M34). */
  visitor?: boolean;
  panel: ReaderPanel;
  setPanel: (panel: ReaderPanel) => void;
  notes: Annotation[];
  rewritten: { mode: RewrittenMode; last: Exclude<RewrittenMode, "original"> };
  showRewritten: (mode: RewrittenMode) => void;
  bookmarkHere: Annotation | undefined;
  toggleBookmark: () => Promise<void>;
  /** The whole-book focus, if one is on: no sitting session can start during it. */
  bookFocus: { focus: unknown };
  setFocusStart: (open: boolean) => void;
}) {
  const { rail, panel, setPanel, notes, rewritten, showRewritten, bookmarkHere, toggleBookmark, bookFocus, setFocusStart } = props;
  return (
    <nav ref={rail} id="reader-sidebar" className={styles.rail} aria-label="Reading tools">
      {/* M34: a visitor gets Study and Rewritten only (no notes, bookmarks or focus: those need an account). */}
      {props.visitor ? null : (
      <button
        type="button"
        className={styles.railTool}
        aria-expanded={panel === "notes"}
        onClick={() => setPanel(panel === "notes" ? "none" : "notes")}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M4 2.5h7l3 3v10H4z M11 2.5v3h3 M6.5 9h5 M6.5 12h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <span className={styles.railWord}>
          Notes{notes.length ? <span> ({notes.length})</span> : null}
        </span>
      </button>
      )}
      {/* Study (M19 P5): "What do I need to know?", Test yourself, Ask and Explain it back, as tabs. */}
      <button
        type="button"
        className={styles.railTool}
        aria-expanded={panel === "know" || panel === "questions" || panel === "ask" || panel === "explain"}
        aria-label="Study"
        title="Study: what this chapter takes for granted, questions on it, and your own summary of it"
        onClick={() => setPanel(panel === "know" || panel === "questions" || panel === "ask" || panel === "explain" ? "none" : "know")}
      >
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 4.3C6.4 3.1 4.2 2.8 1.8 3.3v9.4c2.4-.5 4.6-.2 6.2 1 1.6-1.2 3.8-1.5 6.2-1V3.3c-2.4-.5-4.6-.2-6.2 1zM8 4.3v9.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
        <span className={styles.railWord}>Study</span>
      </button>
      <button
        type="button"
        className={styles.railTool}
        aria-pressed={rewritten.mode !== "original"}
        aria-label="Rewritten view"
        title="Read it rewritten, in your AI explanations style"
        onClick={() => showRewritten(rewritten.mode !== "original" ? "original" : rewritten.last)}
      >
        <svg width="20" height="18" viewBox="0 0 18 16" aria-hidden="true">
          <rect x="1" y="2" width="7" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3 5h3M3 7.5h3M3 10h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M10.5 2.5h5.5v11h-5.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 1.4" />
          <path d="M12.5 5.5h2M12.5 8h2M12.5 10.5h1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
        <span className={styles.railWord}>Rewritten</span>
      </button>
      {/* Who & what (M32), with the names on this page at its top: opened when wanted, never over the text
          (Samuel, 2026-11-08: the "On this page" strip sometimes hid the reading). Not for a visitor (M34),
          whose Study has no Who & what tab either. */}
      {props.visitor ? null : (
      <button
        type="button"
        className={styles.railTool}
        aria-expanded={panel === "xray"}
        title="Who & what: the names on this page, and everyone the book has named so far"
        onClick={() => setPanel(panel === "xray" ? "none" : "xray")}
      >
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="5.5" cy="5" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1.5 13.5c.4-2.6 2-4 4-4s3.6 1.4 4 4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M10.5 4h4M10.5 7h4M12 10h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        {/* One short word: "Who & what" wrapped onto two lines on a phone, which made the bar taller and the page shorter. */}
        <span className={styles.railWord}>Names</span>
      </button>
      )}
      {props.visitor ? null : (
      <button
        type="button"
        className={styles.railTool}
        aria-pressed={Boolean(bookmarkHere)}
        aria-label={bookmarkHere ? "Remove bookmark" : "Bookmark this page"}
        onClick={() => void toggleBookmark()}
      >
        <svg width="16" height="18" viewBox="0 0 14 16" aria-hidden="true">
          <path d="M2 1.5h10v13l-5-3.5-5 3.5z" fill={bookmarkHere ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        <span className={styles.railWord}>Bookmark</span>
      </button>
      )}
      {/* A focus session with a question (M26 R3). Not during a whole-book focus (M26 R5): one at a time. */}
      {bookFocus.focus || props.visitor ? null : (
        <button
          type="button"
          className={styles.railTool}
          aria-label="Focus session"
          title="Focus session: write the question you are reading to answer, set a timer, and see only the page"
          aria-haspopup="dialog"
          onClick={() => setFocusStart(true)}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 6v3l2 1.5M6 1.5h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className={styles.railWord}>Focus</span>
        </button>
      )}
    </nav>
  );
}
