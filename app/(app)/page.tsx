import type { Metadata } from "next";
import { Cover } from "@/components/Cover";
import { PathView } from "@/components/PathView";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { notesForPath } from "@/lib/library/annotations";
import { NOT_YET } from "@/lib/library/availability";
import { coverSigner } from "@/lib/library/covers";
import { getPathView, listPaths } from "@/lib/library/paths";
import { STARTER_PATHS } from "@/lib/library/seed";
import { addPathAction } from "./actions";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Library" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  const db = await getDb();
  const [first] = await listPaths(db, user.id);
  const path = first ? await getPathView(db, user.id, first.slug, await coverSigner()) : null;

  if (path) {
    const notes = await notesForPath(db, user.id, path.id);
    return (
      <main className={styles.main}>
        <PathView path={path} notes={notes} />
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Your library</p>
      <h1 className={styles.title}>Good to see you, {user.name.split(" ")[0]}</h1>
      <p className={styles.lede}>
        Your shelf is empty. Start from a study path: pillars of books, each with a story to read first and a deeper
        book to read second.
      </p>
      <div className={styles.starters}>
        {Object.values(STARTER_PATHS).map((p) => (
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
    </main>
  );
}
