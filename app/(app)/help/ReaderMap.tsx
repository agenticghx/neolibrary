"use client";

import { useState } from "react";
import styles from "./page.module.css";

type SpotId = "contents" | "aa" | "highlight" | "study" | "focus" | "listen";

function spotDetails(isAdmin: boolean): Record<SpotId, { label: string; text: string }> {
  return {
    contents: {
      label: "Contents",
      text: "Jump to any chapter. Your place syncs across devices with a brief 'Where were we?' reminder when you return.",
    },
    aa: {
      label: "Aa · Reading settings",
      text: "Adjust text size, 7 paper themes, Pages or Scroll, and Reading ruler to dim surrounding lines.",
    },
    highlight: {
      label: "Select any passage",
      text: "Highlight, write or speak a note, add a sticker or drawing, or rewrite a paragraph in plain English or STE. Every edit keeps its history.",
    },
    study: {
      label: "Study (6 tabs)",
      text: isAdmin
        ? "Need to know, Test yourself, Ask, Explain it back, Who & what (X-ray), and Genealogy. AI blocks are dashed and show model and cost."
        : "Need to know, Test yourself, Ask, Explain it back, Who & what (X-ray), and Genealogy. Add your own Anthropic/ElevenLabs keys in Account or Aa for new AI answers.",
    },
    focus: {
      label: "Focus timer",
      text: "Start with a question and a timer; hides distractions and saves your answer to Daily review.",
    },
    listen: {
      label: "Listen bar",
      text: "Reads aloud with live word highlighting using your own audiobook (free) or an AI voice (shows price first and stops at your spending cap).",
    },
  };
}

/**
 * Interactive visual map of the Reader (Option B, Samuel 2026-11-26): click any hotspot
 * to read a one-line plain-English explanation instead of scrolling through prose cards.
 */
export function ReaderMap({ isAdmin }: { isAdmin: boolean }) {
  const [active, setActive] = useState<SpotId>("study");
  const spots = spotDetails(isAdmin);
  const current = spots[active];

  const cls = (id: SpotId, extra?: string) =>
    [styles.spot, extra ?? "", active === id ? styles.spotActive : ""].filter(Boolean).join(" ");

  return (
    <section className={styles.mapCard} aria-labelledby="reader-map-h">
      <div className={styles.mapHead}>
        <h2 id="reader-map-h" className={styles.cardTitle}>
          Inside the reader
        </h2>
        <span className={styles.mapHint}>Tap any control</span>
      </div>

      <div className={styles.miniReader}>
        <div className={styles.miniTop}>
          <button type="button" className={cls("contents")} aria-pressed={active === "contents"} onClick={() => setActive("contents")}>
            <svg className={styles.miniIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M5 3.5h8.5M5 8h8.5M5 12.5h8.5" />
              <circle cx="2.2" cy="3.5" r="0.9" fill="currentColor" stroke="none" />
              <circle cx="2.2" cy="8" r="0.9" fill="currentColor" stroke="none" />
              <circle cx="2.2" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
            </svg>
            Contents
          </button>
          <span className={styles.miniBookTitle}>Chapter 3 · The Grid</span>
          <button type="button" className={cls("aa")} aria-pressed={active === "aa"} onClick={() => setActive("aa")}>
            Aa
          </button>
        </div>

        <div className={styles.miniMiddle}>
          <div className={styles.miniPage}>
            <span className={styles.miniLine} aria-hidden="true" />
            <button type="button" className={cls("highlight", styles.spotPassage)} aria-pressed={active === "highlight"} onClick={() => setActive("highlight")}>
              Select any passage to highlight, note, or rewrite
            </button>
            <span className={`${styles.miniLine} ${styles.miniLineShort}`} aria-hidden="true" />
          </div>

          <div className={styles.miniRail}>
            <button type="button" className={cls("study")} aria-pressed={active === "study"} onClick={() => setActive("study")}>
              Study
            </button>
            <button type="button" className={cls("focus")} aria-pressed={active === "focus"} onClick={() => setActive("focus")}>
              Focus
            </button>
          </div>
        </div>

        <div className={styles.miniFoot}>
          <button type="button" className={cls("listen")} aria-pressed={active === "listen"} onClick={() => setActive("listen")}>
            <svg className={styles.miniIcon} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4.5 3.2v9.6L12.5 8z" />
            </svg>
            Listen
          </button>
          <span className={styles.miniProgress}>Page 42 · 38%</span>
        </div>
      </div>

      <p className={styles.callout} role="status" aria-live="polite">
        <strong className={styles.calloutLabel}>{current.label}:</strong> {current.text}
      </p>
    </section>
  );
}
