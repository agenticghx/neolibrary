"use client";

import { useMemo } from "react";
import { compareReadability } from "@/lib/library/readability";
import styles from "./Readability.module.css";

/**
 * The reading level of a paragraph and of its rewrite (M21): "Grade 14 [arrow] 8", by the
 * Flesch-Kincaid formula (lib/library/readability.ts). Screen readers hear "Reading level: original
 * grade 14, this rewrite grade 8"; opening it (a tap, a click or Enter, so it works on phones too)
 * shows what the grade means and its limit. Nothing shows when either text has no words. The arrow
 * is drawn, not typed: the bundled fonts have no arrow character (lib/glyphs.test.ts).
 */
export function ReadabilityBadge({ original, rewrite }: { original: string; rewrite: string }) {
  const r = useMemo(() => compareReadability(original, rewrite), [original, rewrite]);
  if (!r) return null;
  return (
    <details className={styles.readability} data-testid="readability">
      <summary className={styles.badge}>
        <span aria-hidden="true" data-part="shown">
          Grade {r.from}{" "}
          <svg className={styles.arrow} viewBox="0 0 16 16" focusable="false">
            <path d="M2 8h11M9 4l4 4-4 4" />
          </svg>{" "}
          {r.to}
        </span>
        <span className="visually-hidden">{r.label}</span>
      </summary>
      <p className={styles.note}>{r.note}</p>
    </details>
  );
}
