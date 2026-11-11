"use client";

import Link from "next/link";
import { setSidebarOpen } from "./sidebar";
import { type ReaderPanel } from "./reader-helpers";
import styles from "./reader.module.css";

/**
 * The reader's top bar: back to the library, Contents, the book's title, full screen, Reading settings (Aa) and the
 * sidebar's switch. Moved out of Reader.tsx as it was (the version 2 split): it shows the bar and reports each tap.
 */
export function ReaderBar(props: {
  title: string;
  author?: string | null;
  /** A visitor goes back to the open shelf, not to a library of their own (M34). */
  visitor?: { backHref: string };
  panel: ReaderPanel;
  setPanel: (panel: ReaderPanel) => void;
  /** Full screen is offered (not on an iPhone, nor on a narrow screen). */
  canFull: boolean;
  full: boolean;
  toggleFull: () => void;
  sidebar: boolean;
}) {
  const { panel, setPanel, canFull, full, toggleFull, sidebar } = props;
  return (
    <header className={styles.bar}>
      {/* Left, as in Kindle: leave the book, and the table of contents. */}
      <div className={styles.lead}>
        <Link
          href={props.visitor?.backHref ?? "/"}
          className={`${styles.tool} ${styles.leadTool}`}
          aria-label={props.visitor ? "Back to the shelf" : "Back to your library"}
          title={props.visitor ? "Back to the shelf" : "Back to your library"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 2.5 4.5 8l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <button
          type="button"
          className={`${styles.tool} ${styles.leadTool}`}
          aria-label="Contents"
          title="Contents"
          aria-expanded={panel === "contents"}
          onClick={() => setPanel(panel === "contents" ? "none" : "contents")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5.5 3.5h8M5.5 8h8M5.5 12.5h8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="2.5" cy="3.5" r="1" fill="currentColor" />
            <circle cx="2.5" cy="8" r="1" fill="currentColor" />
            <circle cx="2.5" cy="12.5" r="1" fill="currentColor" />
          </svg>
        </button>
      </div>
      <p className={styles.title}>
        <span className={styles.titleText}>{props.title}</span>
        {props.author ? <span className={styles.author}> · {props.author}</span> : null}
      </p>
      <div className={styles.tools}>
        {canFull ? (
          <button
            type="button"
            className={`${styles.tool} ${styles.leadTool} ${styles.fullTool}`}
            aria-pressed={full}
            aria-label={full ? "Leave full screen" : "Full screen"}
            title={full ? "Leave full screen (F or Esc)" : "Full screen (F)"}
            onClick={toggleFull}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d={full ? "M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" : "M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          className={styles.tool}
          aria-expanded={panel === "settings"}
          aria-label="Reading settings"
          onClick={() => setPanel(panel === "settings" ? "none" : "settings")}
        >
          Aa
        </button>
        <button
          type="button"
          className={`${styles.tool} ${styles.leadTool}`}
          aria-expanded={sidebar}
          aria-label="Sidebar"
          title={
            props.visitor
              ? sidebar
                ? "Hide the sidebar: Study, Rewritten"
                : "Show the sidebar: Study, Rewritten"
              : sidebar
                ? "Hide the sidebar: Notes, Study, Rewritten, Bookmark, Focus"
                : "Show the sidebar: Notes, Study, Rewritten, Bookmark, Focus"
          }
          onClick={() => {
            if (sidebar && panel !== "settings" && panel !== "contents") setPanel("none");
            setSidebarOpen(!sidebar);
          }}
        >
          <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
            <rect x="1.5" y="2" width="15" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M11.5 2v12" stroke="currentColor" strokeWidth="1.4" />
            {sidebar ? <path d="M11.5 2.7h3.3a1 1 0 0 1 1 1v8.6a1 1 0 0 1-1 1h-3.3z" fill="currentColor" /> : null}
          </svg>
        </button>
      </div>
    </header>
  );
}
