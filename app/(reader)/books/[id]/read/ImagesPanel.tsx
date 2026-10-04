"use client";

import { useEffect, useState } from "react";
import type { ImageResult } from "@/lib/images/search";
import styles from "./reader.module.css";

/**
 * "See it" (M9): pictures of a word or phrase from Wikimedia Commons, each
 * with its credit and licence on the card.
 */
export function ImagesPanel({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [searched, setSearched] = useState(initialQuery);
  const [results, setResults] = useState<ImageResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/images/search?${new URLSearchParams({ q: searched })}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) {
          setError(body.error ?? "Images could not be found.");
          setResults([]);
        } else {
          setError(null);
          setResults(body.results);
        }
      })
      .catch(() => live && setError("Images could not be found."));
    return () => {
      live = false;
    };
  }, [searched]);

  return (
    <section className={styles.panel} aria-label="See it">
      <p className={styles.panelTitle}>See it</p>
      <form
        className={styles.imageSearch}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim() && query.trim() !== searched) {
            setResults(null);
            setSearched(query.trim());
          }
        }}
      >
        <label htmlFor="image-query" className="visually-hidden">
          Search pictures
        </label>
        <input id="image-query" className={styles.percentInput} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className={styles.tool}>
          Search
        </button>
      </form>
      <p className={styles.hint}>Free pictures from Wikimedia Commons. Check the licence before you reuse one.</p>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      {results === null ? <p className={styles.hint}>Looking…</p> : null}
      {results && !results.length && !error ? <p className={styles.hint}>No pictures found for “{searched}”.</p> : null}
      {results && results.length ? (
        <ul className={styles.imageGrid} data-testid="image-results" aria-label={`Pictures of ${searched}`}>
          {results.map((r) => (
            <li key={r.id} className={styles.imageCard}>
              {/* eslint-disable-next-line @next/next/no-img-element -- outside images with their own sizes; Next's optimiser is not set up for them */}
              <img src={r.thumbUrl} alt={r.title} width={r.width} height={r.height} loading="lazy" className={styles.imageThumb} />
              <p className={styles.imageTitle}>{r.title}</p>
              <p className={styles.imageCredit}>
                {r.credit} ·{" "}
                {r.licenceUrl ? (
                  <a href={r.licenceUrl} target="_blank" rel="noopener noreferrer">
                    {r.licence}
                  </a>
                ) : (
                  r.licence
                )}{" "}
                ·{" "}
                <a href={r.pageUrl} target="_blank" rel="noopener noreferrer">
                  Source
                </a>
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
