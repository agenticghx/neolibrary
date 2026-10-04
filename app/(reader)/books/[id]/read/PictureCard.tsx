"use client";

import type { PinnedPicture } from "@/lib/library/pinned";
import styles from "./reader.module.css";

/**
 * A pinned picture (M9): from Wikimedia Commons with its credit and licence,
 * or generated, always labelled as such. `url` is the signed link for a
 * generated picture's stored file.
 */
export function PictureView({ picture, url, large = false }: { picture: PinnedPicture; url?: string; large?: boolean }) {
  if (picture.source === "generated") {
    return (
      <figure className={styles.machine} data-testid="pinned-picture">
        <figcaption className={styles.machineLabel}>Generated image · made by AI, not a photograph</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element -- a stored picture behind a signed link */}
        {url ? <img src={url} alt={`Generated picture of ${picture.subject}`} className={styles.imageThumb} /> : null}
        <p className={styles.provenance}>
          {picture.subject} · {picture.model}
        </p>
      </figure>
    );
  }
  return (
    <figure className={styles.pinned} data-testid="pinned-picture">
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture from Wikimedia Commons */}
      <img src={large ? picture.imageUrl : picture.thumbUrl} alt={picture.title} className={styles.imageThumb} />
      <figcaption className={styles.imageCredit}>
        <span className={styles.imageTitle}>{picture.title}</span> · {picture.credit} ·{" "}
        {picture.licenceUrl ? (
          <a href={picture.licenceUrl} target="_blank" rel="noopener noreferrer">
            {picture.licence}
          </a>
        ) : (
          picture.licence
        )}{" "}
        ·{" "}
        <a href={picture.pageUrl} target="_blank" rel="noopener noreferrer">
          Source
        </a>
      </figcaption>
    </figure>
  );
}

/** The pop-up card opened from a pinned picture's marker in the margin. */
export function PictureCard({ picture, url, quote }: { picture: PinnedPicture; url?: string; quote: string }) {
  return (
    <section className={styles.panel} aria-label="Pinned picture">
      <p className={styles.panelTitle}>Pinned picture</p>
      <blockquote className={styles.noteQuote}>{quote}</blockquote>
      <PictureView picture={picture} url={url} large />
    </section>
  );
}
