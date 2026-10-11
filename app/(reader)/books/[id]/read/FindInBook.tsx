"use client";

import { useState } from "react";
import type { SearchHit } from "@/lib/library/search";
import styles from "./reader.module.css";

/**
 * Find in this book (M20 Q5), in Contents: the library's search, for this
 * book only, with the hits in reading order. A hit opens its paragraph.
 */
export function FindInBook({ bookId, onGo }: { bookId: string; onGo: (cfi: string) => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ q: string; hits: SearchHit[] } | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "failed">("idle");

  const find = async () => {
    const q = query.trim();
    if (!q) return;
    setState("searching");
    try {
      const res = await fetch(`/api/books/${bookId}/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(String(res.status));
      // Shown in curly quotes, so a phrase typed with straight ones loses those.
      setResult({ q: q.replace(/"/g, ""), hits: ((await res.json()) as { hits: SearchHit[] }).hits });
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className={styles.findInBook}>
      <form
        role="search"
        className={styles.findForm}
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <label htmlFor="find-in-book" className={styles.groupLabel}>
          Find in this book
        </label>
        <div className={styles.jumpRow}>
          <input
            id="find-in-book"
            className={styles.findInput}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="A word or “a phrase”"
          />
          <button type="submit" className={styles.tool} disabled={!query.trim() || state === "searching"}>
            Find
          </button>
        </div>
      </form>
      <p className={styles.hint} role="status">
        {state === "searching"
          ? "Searching…"
          : state === "failed"
            ? "The search did not work. Try again."
            : result
              ? result.hits.length === 0
                ? `Nothing found for “${result.q}”.`
                : `${result.hits.length === 60 ? "The first 60 places" : result.hits.length === 1 ? "1 place" : `${result.hits.length} places`} with “${result.q}”, in reading order.`
              : ""}
      </p>
      {result?.hits.length ? (
        <ol className={styles.findHits} data-testid="find-hits">
          {result.hits.map((h) => (
            <li key={h.sectionId}>
              <button type="button" className={styles.findHit} onClick={() => onGo(h.cfi)}>
                {h.chapter ? <span className={styles.groupLabel}>{h.chapter}</span> : null}
                <span className={styles.findSnippet}>
                  {h.snippet.map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
