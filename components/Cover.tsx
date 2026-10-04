import Link from "next/link";
import styles from "./Cover.module.css";

export type CoverTone = "navy" | "green";
export type Slot = "N" | "E" | "extra" | "master";

/**
 * A plain typographic book cover (title + slot letter on cloth).
 * Never imitates real published cover art. Unowned books are drawn dimmed.
 */
export function Cover({
  title,
  slot,
  tone = "navy",
  owned = true,
  size = "md",
  href,
  progress,
  current = false,
  imageUrl,
}: {
  title: string;
  slot?: Slot;
  tone?: CoverTone;
  owned?: boolean;
  size?: "md" | "sm";
  href?: string;
  /** 0–1; drawn as a thin bar under owned books that have been started. */
  progress?: number;
  /** Marks the book to read next ("you are here"). */
  current?: boolean;
  /** The book's own cover image (from its file), shown instead of the typographic cover. */
  imageUrl?: string | null;
}) {
  const className = [
    styles.cover,
    owned ? styles[tone] : styles.unowned,
    size === "sm" ? styles.small : "",
    current ? styles.current : "",
  ].join(" ");
  const titleClass = [styles.title, styles[titleSize(title)]].join(" ");
  const face =
    imageUrl && owned ? (
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
        <Link href={href} className={styles.link} aria-label={`${title}${owned ? "" : " (not owned)"}`}>
          {face}
        </Link>
      ) : (
        face
      )}
      {owned && progress !== undefined && progress > 0 ? (
        <span className={styles.progress} aria-label={`${Math.round(progress * 100)}% read`}>
          <span className={styles.progressFill} data-progress={Math.round(progress * 20) * 5} />
        </span>
      ) : null}
      {owned ? null : <figcaption className={styles.caption}>Not owned</figcaption>}
    </figure>
  );
}

/** Long words get a smaller size so they fit the cover without breaking. */
export function titleSize(title: string): "long" | "veryLong" | "normal" {
  const longest = Math.max(...title.split(/\s+/).map((w) => w.length));
  return longest > 13 ? "veryLong" : longest > 9 ? "long" : "normal";
}
