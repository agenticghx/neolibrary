"use client";

import styles from "./reader.module.css";
import own from "./StudyTabs.module.css";

export type StudyTab = "know" | "questions" | "ask" | "explain" | "xray";

/** M34: the Study tabs a visitor (not signed in) may use on a free book. */
export const VISITOR_TABS: StudyTab[] = ["know", "questions"];

const TABS: [StudyTab, string][] = [
  ["know", "Need to know"],
  ["questions", "Test yourself"],
  ["ask", "Ask"],
  ["explain", "Explain it back"],
  ["xray", "Who & what"],
];

/**
 * The parts of Study (M19 P5, M21, M26, M32): the ideas a chapter takes for granted, questions on it, a question of
 * your own answered from the book, your own summary of the chapter, checked against it, and who and what the book
 * names (X-ray). Tabs at the top of each panel, so each is one press away. The arrow keys move between them.
 */
export function StudyTabs({ current, onPick, only }: { current: StudyTab; onPick: (tab: StudyTab) => void; only?: StudyTab[] }) {
  // M34: a visitor gets only the tabs that need no account (Need to know, Test yourself).
  const tabs = only ? TABS.filter(([tab]) => only.includes(tab)) : TABS;
  return (
    <div role="tablist" aria-label="Study" className={`${styles.studyTabs} ${own.tabs}`}>
      {tabs.map(([tab, label], i) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={current === tab}
          tabIndex={current === tab ? 0 : -1}
          className={`${styles.studyTab} ${own.tab}`}
          onClick={() => tab !== current && onPick(tab)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            onPick(tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length][0]);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
