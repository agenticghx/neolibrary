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
  href,
  progress,
  current = false,
  imageUrl,
}: {
  title: string;
  slot?: Slot;
  tone?: CoverTone;
  /** What the title offers (lib/library/availability.ts). Required, so no page forgets to work it out. */
  available: Availability;
  /** Show the availability label ("Read only", ...) under the cover; off where the page shows it itself. */
  caption?: boolean;
  size?: "md" | "sm";
  href?: string;
  /** 0–1; drawn as a thin bar under available books that have been started. */
  progress?: number;
  /** Marks the book to read next ("you are here"). */
  current?: boolean;
  /** The book's own cover image (from its file), shown instead of the typographic cover. */
  imageUrl?: string | null;
}) {
  const any = isAvailable(available);
  const className = [
    styles.cover,
    any ? styles[tone] : styles.empty,
    size === "sm" ? styles.small : "",
    current ? styles.current : "",
  ].join(" ");
  const titleClass = [styles.title, styles[titleSize(title)]].join(" ");
  const face =
    imageUrl && any ? (
      <div className={[className, styles.withImage].join(" ")}>
        {/* Signed, short-lived URL to the user's own file; next/image cannot optimise it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className={styles.image} />
        {slot === "N" || slot === "E" ? <span className={[styles.slot, styles.slotOnImage].join(" ")}>{slot}</span> : null}
      </div>
    ) : (
      <div className={className}>
        <span className={titleClass}>{title}</span>
        {slot === "N" || slot === "E" ? <span className={styles.slot}>{slot}</span> : null}
      </div>
    );
  return (
    <figure className={styles.figure}>
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
