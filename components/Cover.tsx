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
}: {
  title: string;
  slot?: Slot;
  tone?: CoverTone;
  owned?: boolean;
}) {
  const className = [styles.cover, owned ? styles[tone] : styles.unowned].join(" ");
  const titleClass = [styles.title, styles[titleSize(title)]].join(" ");
  return (
    <figure className={styles.figure}>
      <div className={className}>
        <span className={titleClass}>{title}</span>
        {slot === "N" || slot === "E" ? <span className={styles.slot}>{slot}</span> : null}
      </div>
      {owned ? null : <figcaption className={styles.caption}>Not owned</figcaption>}
    </figure>
  );
}

/** Long words get a smaller size so they fit the cover without breaking. */
export function titleSize(title: string): "long" | "veryLong" | "normal" {
  const longest = Math.max(...title.split(/\s+/).map((w) => w.length));
  return longest > 13 ? "veryLong" : longest > 9 ? "long" : "normal";
}
