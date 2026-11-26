"use client";

import type { CrossLink } from "@/lib/library/crosslinks";
import { EditionSwitch } from "./ReaderControls";
import { type ReaderPanel } from "./reader-helpers";
import styles from "./reader.module.css";

/**
 * The foot of the reading page: the chapter's name, links to the reader's other books, the progress line, Scan | Text
 * for a scanned book, Listen, and the percentage read. Moved out of Reader.tsx as it was (the version 2 split).
 */
export function ReaderFoot(props: {
  where: { cfi: string | null; fraction: number; chapter: string };
  percent: number;
  links: CrossLink[];
  panel: ReaderPanel;
  setPanel: (panel: ReaderPanel) => void;
  edition?: { scanId: string; textId: string; current: "scan" | "text" };
  scanPage: number | null;
  /** A visitor has no Listen (M34). */
  visitor?: boolean;
  listening: boolean;
  setListening: (on: boolean) => void;
  stopListening: () => void;
  dismissSelection: () => void;
}) {
  const { where, percent, links, panel, setPanel, scanPage, listening, setListening, stopListening, dismissSelection } = props;
  const linksLabel = links.length === 1 ? "1 link to your other books" : `${links.length} links to your other books`;
  return (
    <footer className={styles.foot}>
      <span className={styles.progress} aria-hidden="true">
        <span className={styles.progressFill} data-progress={where.fraction > 0 ? Math.min(100, Math.max(2, Math.round(where.fraction * 50) * 2)) : 0} />
      </span>
      <span className={styles.chapter}>
        <span className={styles.chapterName}>{where.chapter}</span>
        {links.length ? (
          <button
            type="button"
            className={styles.linksButton}
            aria-expanded={panel === "links"}
            aria-label={linksLabel}
            title={linksLabel}
            onClick={() => setPanel(panel === "links" ? "none" : "links")}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6.8 9.2a3.2 3.2 0 0 0 4.5 0l1.9-1.9a3.2 3.2 0 0 0-4.5-4.5L7.6 3.9" />
              <path d="M9.2 6.8a3.2 3.2 0 0 0-4.5 0L2.8 8.7a3.2 3.2 0 0 0 4.5 4.5l1.1-1.1" />
            </svg>
            <span aria-hidden="true">{links.length}</span>
          </button>
        ) : null}
      </span>
      <span className={styles.footRight}>
        {props.edition ? <EditionSwitch edition={props.edition} scanPage={scanPage} /> : null}
        {props.visitor ? null : (
          <button
            type="button"
            className={styles.listenButton}
            aria-pressed={listening}
            aria-label="Listen"
            disabled={!where.cfi}
            title="Read aloud"
            onClick={() => {
              // The Read aloud bar opens where the selected-text bar sits (M27 Q1): one at a time.
              if (!listening) dismissSelection();
              if (listening) stopListening();
              else setListening(true);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 5h2.5L8 2v10L4.5 9H2z" fill="currentColor" />
              <path d="M10 4.5a3.5 3.5 0 0 1 0 5M11.5 3a5.5 5.5 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <span className={styles.percent} aria-label={`${percent}% read`}>
          {percent}%
        </span>
      </span>
    </footer>
  );
}
