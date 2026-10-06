import Link from "next/link";
import { availabilityLabel, isAvailable, type Availability } from "@/lib/library/availability";
import styles from "./Cover.module.css";

export type CoverTone = "navy" | "green";
export type Slot = "N" | "E" | "extra" | "master";

/**
 * A plain typographic book cover (title + slot letter on cloth).
 * Never imitates real published cover art. A title with nothing to read or
 * listen to yet is drawn greyed (undyed cloth) and never shows an image.
 */
export function Cover({
  title,
  slot,
  tone = "navy",
  available,
  caption = true,
  size = "md",
  decorative = false,
  href,
  progress,
  current = false,
  imageUrl,
  marks,
}: {
  title: string;
  slot?: Slot;
  tone?: CoverTone;
  /** What the title offers (lib/library/availability.ts). Required, so no page forgets to work it out. */
  available: Availability;
  /** Show the availability label ("Read only", ...) under the cover; off where the page shows it itself. */
  caption?: boolean;
  /** "fill": as wide as its grid column (the library grid); "mini": a small swatch beside a title (Continue). */
  size?: "md" | "sm" | "fill" | "mini";
  /** The page shows the title beside the cover: hide the cover's own lettering from screen readers. */
  decorative?: boolean;
  href?: string;
  /** 0–1; drawn as a thin bar under available books that have been started. */
  progress?: number;
  /** Marks the book to read next ("you are here"). */
  current?: boolean;
  /** The book's own cover image (from its file), shown instead of the typographic cover. */
  imageUrl?: string | null;
  /**
   * Marks drawn on the cover (decorative; the text beside it says the same): a folded corner when
   * the book has the reader's notes, headphones when it has an uploaded audiobook, a tick when finished.
   */
  marks?: { notes?: boolean; audiobook?: boolean; finished?: boolean };
}) {
  const any = isAvailable(available);
  const className = [
    styles.cover,
    any ? styles[tone] : styles.empty,
    size === "sm" ? styles.small : size === "fill" ? styles.fill : size === "mini" ? styles.mini : "",
    current ? styles.current : "",
  ].join(" ");
  const titleClass = [styles.title, styles[titleSize(title)]].join(" ");
  const drawn =
    any && marks ? (
      <>
        {marks.notes ? <span className={styles.fold} aria-hidden="true" data-mark="notes" /> : null}
        {marks.audiobook ? (
          <span className={styles.audioMark} aria-hidden="true" data-mark="audiobook">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1z" />
            </svg>
          </span>
        ) : null}
        {marks.finished ? (
          <span className={styles.doneMark} aria-hidden="true" data-mark="finished">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        ) : null}
      </>
    ) : null;
  const face =
    imageUrl && any ? (
      <div className={[className, styles.withImage].join(" ")} aria-hidden={decorative || undefined}>
        {/* Signed, short-lived URL to the user's own file; next/image cannot optimise it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className={styles.image} />
        {slot === "N" || slot === "E" ? <span className={[styles.slot, styles.slotOnImage].join(" ")}>{slot}</span> : null}
        {drawn}
      </div>
    ) : (
      <div className={className} aria-hidden={decorative || undefined}>
        <span className={titleClass}>{title}</span>
        {slot === "N" || slot === "E" ? <span className={styles.slot}>{slot}</span> : null}
        {drawn}
      </div>
    );
  return (
    <figure className={[styles.figure, size === "fill" ? styles.fillFigure : ""].join(" ")}>
      {href ? (
        <Link href={href} className={styles.link} aria-label={`${title}${any ? "" : " (not available yet)"}`}>
          {face}
        </Link>
      ) : (
        face
      )}
      {any && progress !== undefined && progress > 0 ? (
        // role="img": a plain span may not carry a label (axe: aria-prohibited-attr), so screen readers skipped it.
        <span className={styles.progress} role="img" aria-label={`${Math.round(progress * 100)}% read`}>
          <span className={styles.progressFill} data-progress={Math.round(progress * 20) * 5} />
        </span>
      ) : null}
      {caption ? <figcaption className={styles.caption}>{availabilityLabel(available)}</figcaption> : null}
    </figure>
  );
}

/** Long words get a smaller size so they fit the cover without breaking. */
export function titleSize(title: string): "long" | "veryLong" | "normal" {
  const longest = Math.max(...title.split(/\s+/).map((w) => w.length));
  return longest > 13 ? "veryLong" : longest > 9 ? "long" : "normal";
}
