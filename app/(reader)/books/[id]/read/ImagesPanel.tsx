"use client";

import { useEffect, useState } from "react";
import type { ImageResult } from "@/lib/images/search";
import type { PinnedPicture } from "@/lib/library/pinned";
import styles from "./reader.module.css";

/**
 * "See it" (M9): pictures of a word or phrase from Wikimedia Commons, each
 * with its credit and licence on the card.
 */
type Picture = { id: string; subject: string; key: string; url: string; model: string; costUsd: number; createdAt: string };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function ImagesPanel({
  bookId,
  initialQuery,
  onPin,
}: {
  bookId: string;
  initialQuery: string;
  /** Pins a picture to the passage the panel was opened from (absent when there is none). */
  onPin?: (picture: PinnedPicture) => Promise<void>;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [searched, setSearched] = useState(initialQuery);
  const [results, setResults] = useState<ImageResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picture, setPicture] = useState<{ picture: Picture | null; estimate: number | null } | null>(null);
  const [making, setMaking] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const pin = async (id: string, picture: PinnedPicture) => {
    if (!onPin) return;
    setPinError(null);
    try {
      await onPin(picture);
      setPinned(id);
    } catch (e) {
      setPinError((e as Error).message);
    }
  };

  const pinButton = (id: string, picture: PinnedPicture) =>
    onPin ? (
      pinned === id ? (
        <p className={styles.pinnedNote} role="status">
          Pinned to the passage
        </p>
      ) : (
        <button type="button" className={styles.tool} onClick={() => void pin(id, picture)} disabled={pinned !== null}>
          Pin to the passage
        </button>
      )
    ) : null;

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
    // A picture already made for this subject, and what making one would cost.
    fetch(`/api/books/${bookId}/pictures?${new URLSearchParams({ subject: searched })}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => live && setPicture(body))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [searched, bookId]);

  const make = async () => {
    setMaking(true);
    setPictureError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/pictures`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: searched }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The picture could not be made.");
      setPicture((p) => ({ estimate: p?.estimate ?? null, picture: body.picture }));
    } catch (e) {
      setPictureError((e as Error).message);
    } finally {
      setMaking(false);
    }
  };

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
              {pinButton(r.id, {
                source: "wikimedia",
                title: r.title,
                thumbUrl: r.thumbUrl,
                imageUrl: r.imageUrl,
                pageUrl: r.pageUrl,
                credit: r.credit,
                licence: r.licence,
                licenceUrl: r.licenceUrl,
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {picture?.picture ? (
        <aside className={styles.machine} aria-label="Generated image" data-testid="generated-picture">
          <p className={styles.machineLabel}>Generated image · made by AI, not a photograph</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored picture behind a signed link */}
          <img src={picture.picture.url} alt={`Generated picture of ${picture.picture.subject}`} className={styles.imageThumb} />
          <p className={styles.provenance}>
            {picture.picture.model} · {when(picture.picture.createdAt)} · ${picture.picture.costUsd.toFixed(2)}
          </p>
          {pinButton(picture.picture.id, { source: "generated", key: picture.picture.key, subject: picture.picture.subject, model: picture.picture.model })}
        </aside>
      ) : picture && results ? (
        <div className={styles.makePicture}>
          <p className={styles.hint}>No good picture? Make one with AI. It is labelled as generated wherever it appears.</p>
          {picture.estimate === null ? (
            <p className={styles.hint}>Making pictures is not set up yet: the owner needs to add an OpenAI API key.</p>
          ) : (
            <div className={styles.noteActions}>
              <button type="button" className={styles.primaryTool} disabled={making} onClick={() => void make()}>
                {making ? "Making the picture…" : `Make a picture of “${searched}” (about $${picture.estimate.toFixed(2)})`}
              </button>
            </div>
          )}
          {pictureError ? (
            <p className={styles.formError} role="alert">
              {pictureError}
            </p>
          ) : null}
        </div>
      ) : null}
      {pinError ? (
        <p className={styles.formError} role="alert">
          {pinError}
        </p>
      ) : null}
    </section>
  );
}
