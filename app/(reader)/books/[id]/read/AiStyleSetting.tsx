"use client";

import { useEffect, useState } from "react";
import type { Style } from "@/lib/library/levels";
import styles from "./reader.module.css";

type Styles = { user: Style; book: Style | null; effective: Style };

const OPTIONS: [Style, string][] = [
  ["plain", "Plain"],
  ["ste-light", "STE light"],
  ["ste-standard", "STE"],
  ["ste-strict", "STE strict"],
];

/** The short name of each style, as the setting shows it. */
export const STYLE_NAMES = Object.fromEntries(OPTIONS) as Record<Style, string>;

/** Sent on the window when the style changes, so the rewritten view (M17) follows it. */
export const STYLE_EVENT = "neolibrary:ai-style";

/**
 * The style AI explanations are written in (M6): plain English or STE
 * (Simplified Technical English) at a strictness. Set for all books, or for
 * this book only.
 */
export function AiStyleSetting({ bookId }: { bookId: string }) {
  const [value, setValue] = useState<Styles | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/books/${bookId}/ai-style`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => live && v && setValue(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [bookId]);

  // Shows the change at once, then takes the server's answer.
  const save = async (body: { scope: "all" | "book"; style: Style | null }) => {
    if (!value) return;
    setError(null);
    const before = value;
    setValue(
      body.scope === "all"
        ? { user: body.style!, book: null, effective: body.style! }
        : { ...value, book: body.style, effective: body.style ?? value.user },
    );
    const res = await fetch(`/api/books/${bookId}/ai-style`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setValue(await res.json());
      window.dispatchEvent(new Event(STYLE_EVENT));
    } else {
      setValue(before);
      setError("Not saved. Try again.");
    }
  };

  if (!value) return null;
  const bookOnly = value.book !== null;
  return (
    <fieldset className={styles.group}>
      <legend>AI explanations</legend>
      <div className={styles.segment}>
        {OPTIONS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={styles.segmentButton}
            aria-pressed={value.effective === v}
            onClick={() => void save({ scope: bookOnly ? "book" : "all", style: v })}
          >
            {label}
          </button>
        ))}
      </div>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={bookOnly}
          onChange={(e) => void save(e.target.checked ? { scope: "book", style: value.effective } : { scope: "book", style: null })}
        />
        Only for this book
      </label>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
