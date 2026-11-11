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
  return (
    <footer className={styles.foot}>
      <span className={styles.chapter}>
        <span className={styles.chapterName}>{where.chapter}</span>
        {links.length ? (
          <button
            type="button"
            className={styles.linksButton}
            aria-expanded={panel === "links"}
            onClick={() => setPanel(panel === "links" ? "none" : "links")}
          >
            {links.length === 1 ? "1 link to your other books" : `${links.length} links to your other books`}
          </button>
        ) : null}
      </span>
      <span className={styles.progress} aria-hidden="true">
        <span className={styles.progressFill} data-progress={Math.round(where.fraction * 50) * 2} />
      </span>
      <span className={styles.footRight}>
        {props.edition ? <EditionSwitch edition={props.edition} scanPage={scanPage} /> : null}
        {props.visitor ? null : (
          <button
            type="button"
            className={styles.listenButton}
            aria-pressed={listening}
            disabled={!where.cfi}
            title="Read aloud"
            onClick={() => {
              // The Read aloud bar opens where the selected-text bar sits (M27 Q1): one at a time.
              if (!listening) dismissSelection();
              if (listening) stopListening();
              else setListening(true);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 5h2.5L8 2v10L4.5 9H2z" fill="currentColor" />
              <path d="M10 4.5a3.5 3.5 0 0 1 0 5M11.5 3a5.5 5.5 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Listen
          </button>
        )}
        <span className={styles.percent} aria-label={`${percent}% read`}>
          {percent}%
        </span>
      </span>
    </footer>
  );
}
