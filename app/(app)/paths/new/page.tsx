import type { Metadata } from "next";
import { NewPathForm } from "@/components/paths/PathForms";
import { requireUser } from "@/lib/auth/session";
import styles from "../page.module.css";

export const metadata: Metadata = { title: "New path" };
export const dynamic = "force-dynamic";

/** Make your own Path (M14 step 5): name it, then add sections of titles in order. */
export default async function NewPathPage() {
  await requireUser();
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Paths</p>
      <h1 className={styles.title}>A new path</h1>
      <p className={styles.lede}>
        A reading plan in your order: sections of titles, each a book from your library or one you have not added yet. Next you
        add the sections and titles.
      </p>
      <div className={styles.form}>
        <NewPathForm />
      </div>
    </main>
  );
}
