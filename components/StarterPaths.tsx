import { addPathAction } from "@/app/(app)/actions";
import { NOT_YET } from "@/lib/library/availability";
import { STARTER_PATHS } from "@/lib/library/seed";
import { Cover } from "./Cover";
import styles from "./StarterPaths.module.css";

/** The built-in reading lists the reader has not added yet, each with "Add this path" (empty Home, /paths). */
export function StarterPaths({ exclude = [] }: { exclude?: string[] }) {
  const offers = Object.values(STARTER_PATHS).filter((p) => !exclude.includes(p.slug));
  if (!offers.length) return null;
  return (
    <div className={styles.starters}>
      {offers.map((p) => (
        <form key={p.slug} action={addPathAction} className={styles.starter}>
          <input type="hidden" name="slug" value={p.slug} />
          <div className={styles.shelf} aria-hidden="true">
            <Cover title={p.pillars[0].books[0].title} slot="N" available={NOT_YET} caption={false} size="sm" />
            <Cover title={p.pillars[0].books[1].title} slot="E" available={NOT_YET} caption={false} size="sm" />
          </div>
          <div className={styles.starterText}>
            <h2 className={styles.starterTitle}>{p.title}</h2>
            <p className={styles.starterNote}>
              {p.pillars.filter((x) => x.group !== "master" && x.group !== "suggested").length} pillars. {p.description}
            </p>
            <button type="submit" className={styles.add}>
              Add this path
            </button>
          </div>
        </form>
      ))}
    </div>
  );
}
