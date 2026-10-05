import type { Metadata } from "next";
import { PathView } from "@/components/PathView";
import { StarterPaths } from "@/components/StarterPaths";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { notesForPath } from "@/lib/library/annotations";
import { coverSigner } from "@/lib/library/covers";
import { getPathView, listPaths } from "@/lib/library/paths";
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
      <StarterPaths />
    </main>
  );
}
