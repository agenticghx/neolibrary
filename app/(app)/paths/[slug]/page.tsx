import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PathView } from "@/components/PathView";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { notesForPath } from "@/lib/library/annotations";
import { coverSigner } from "@/lib/library/covers";
import { getPathView } from "@/lib/library/paths";
import styles from "../page.module.css";

export const metadata: Metadata = { title: "Path" };
export const dynamic = "force-dynamic";

/** One Path: its pillars in order, each title labelled by what is available (M14; redesigned in step 5). */
export default async function PathPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  const db = await getDb();
  const path = await getPathView(db, user.id, (await params).slug, await coverSigner());
  if (!path) notFound();
  const notes = await notesForPath(db, user.id, path.id);
  return (
    <main className={styles.main}>
      <PathView path={path} notes={notes} editHref={`/paths/${path.slug}/edit`} />
    </main>
  );
}
