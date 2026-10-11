"use client";

import styles from "./reader.module.css";

export type StudyTab = "know" | "questions";

const TABS: [StudyTab, string][] = [
  ["know", "Need to know"],
  ["questions", "Test yourself"],
];

/**
 * The two parts of Study (M19 P5): the ideas a chapter takes for granted, and questions on it. Tabs at the top of
 * both panels, so Test yourself is one press away instead of behind a link. The arrow keys move between them.
 */
export function StudyTabs({ current, onPick }: { current: StudyTab; onPick: (tab: StudyTab) => void }) {
  return (
    <div role="tablist" aria-label="Study" className={styles.studyTabs}>
      {TABS.map(([tab, label], i) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={current === tab}
          tabIndex={current === tab ? 0 : -1}
          className={styles.studyTab}
          onClick={() => onPick(tab)}
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
