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
  return (
    <figure className={styles.figure}>
      <div className={className}>
        <span className={styles.title}>{title}</span>
        {slot === "N" || slot === "E" ? <span className={styles.slot}>{slot}</span> : null}
      </div>
      {owned ? null : <figcaption className={styles.caption}>Not owned</figcaption>}
    </figure>
  );
}
