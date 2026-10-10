"use client";

import { useState } from "react";
import { STYLES, VIEWS, type RewrittenView, type Style } from "@/lib/library/levels";
import type { Preferences } from "@/lib/library/preferences";
import styles from "./page.module.css";

const STYLE_NAMES: Record<Style, string> = { plain: "Plain", "ste-light": "STE light", "ste-standard": "STE", "ste-strict": "STE strict" };

/**
 * Reading preferences (M17): the AI explanations style for all books, and the
 * view a book opens in. The reader's own switches change the same settings.
 */
export function ReadingPreferences({ initial }: { initial: Preferences }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  // Shows the change at once, then takes the server's answer.
  const save = async (patch: Partial<Preferences>) => {
    const before = value;
    setError(null);
    setValue({ ...value, ...patch });
    const res = await fetch("/api/account/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (res?.ok) setValue(await res.json());
    else {
      setValue(before);
      setError("Not saved. Try again.");
    }
  };

  return (
    <section className={styles.card} aria-labelledby="reading">
      <h2 id="reading" className={styles.cardTitle}>
        Reading preferences
      </h2>
      <fieldset className={styles.choice}>
        <legend className={styles.choiceLegend}>AI explanations</legend>
        <div className={styles.segment}>
          {(Object.keys(STYLES) as Style[]).map((s) => (
            <button key={s} type="button" className={styles.segmentButton} aria-pressed={value.aiStyle === s} onClick={() => void save({ aiStyle: s })}>
              {STYLE_NAMES[s]}
            </button>
          ))}
        </div>
        <p className={styles.cardText}>
          The style of rewrites and other AI explanations, for every book. STE is Simplified Technical English: one meaning per
          word, short sentences. A book can have its own style, under Aa in the reader.
        </p>
      </fieldset>
      <fieldset className={styles.choice}>
        <legend className={styles.choiceLegend}>A book opens with</legend>
        <div className={styles.segment}>
          {(Object.keys(VIEWS) as RewrittenView[]).map((v) => (
            <button
              key={v}
              type="button"
              className={styles.segmentButton}
              aria-pressed={value.rewrittenView === v}
              onClick={() => void save({ rewrittenView: v })}
            >
              {VIEWS[v]}
            </button>
          ))}
        </div>
        <p className={styles.cardText}>
          Original is the book alone; Side by side puts the rewrite beside the page (under it on a phone); Rewritten shows the
          rewrite alone. The switch in the reader changes this too.
        </p>
      </fieldset>
      {error ? (
        <p className={styles.status} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
