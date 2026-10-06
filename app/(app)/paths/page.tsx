import type { Metadata } from "next";
import Link from "next/link";
import { StarterPaths } from "@/components/StarterPaths";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { partsWord } from "@/lib/library/path-words";
import { listPathsWithProgress } from "@/lib/library/paths";
import { STARTER_PATHS } from "@/lib/library/seed";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Paths" };
export const dynamic = "force-dynamic";

/** The reader's Paths (ordered reading plans), and the built-in reading lists not added yet. */
export default async function PathsPage() {
  const user = await requireUser();
  const list = await listPathsWithProgress(await getDb(), user.id);
  const offersLeft = Object.keys(STARTER_PATHS).some((slug) => !list.some((p) => p.slug === slug));
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Paths</p>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Your paths</h1>
        <Link href="/paths/new" className={styles.newPath}>
          New path
        </Link>
      </div>
      <p className={styles.lede}>
        A path is a reading plan: sections of titles, in order. Titles not available yet wait on the path until you add
        their file.
      </p>
      {list.length ? (
        <ul className={styles.list}>
          {list.map((p) => (
            <li key={p.id} className={styles.item}>
              <Link href={`/paths/${p.slug}`} className={styles.itemTitle}>
                {p.title}
              </Link>
              <span className={styles.itemMeta}>
                {p.total ? `${p.started} of ${p.total} ${partsWord(p.readingList, p.total)} started` : "No sections yet"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.itemMeta}>No paths yet.</p>
      )}
      {offersLeft ? <h2 className={styles.offer}>Start from a reading list</h2> : null}
      <StarterPaths exclude={list.map((p) => p.slug)} />
    </main>
  );
}
