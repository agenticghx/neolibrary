"use client";

import styles from "./reader.module.css";
import own from "./StudyTabs.module.css";

export type StudyTab = "know" | "questions" | "ask" | "explain";

const TABS: [StudyTab, string][] = [
  ["know", "Need to know"],
  ["questions", "Test yourself"],
  ["ask", "Ask"],
  ["explain", "Explain it back"],
];

/**
 * The parts of Study (M19 P5, M21, M26): the ideas a chapter takes for granted, questions on it, a question of
 * your own answered from the book, and your own summary of the chapter, checked against it. Tabs at the top of each panel, so each is one press away. The arrow keys move
 * between them.
 */
export function StudyTabs({ current, onPick }: { current: StudyTab; onPick: (tab: StudyTab) => void }) {
  return (
    <div role="tablist" aria-label="Study" className={`${styles.studyTabs} ${own.tabs}`}>
      {TABS.map(([tab, label], i) => (
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
            onPick(TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0]);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
