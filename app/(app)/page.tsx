import type { Metadata } from "next";
import { Cover } from "@/components/Cover";
import { requireUser } from "@/lib/auth/session";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Library" };

export default async function HomePage() {
  const user = await requireUser();
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Your library</p>
      <h1 className={styles.title}>Good to see you, {user.name.split(" ")[0]}</h1>
      <p className={styles.lede}>
        The shelf is empty for now. Next comes uploading your own books and the Hidden Machinery path, pillar by
        pillar.
      </p>
      <div className={styles.shelf} aria-hidden="true">
        <Cover title="Narrative" slot="N" owned={false} />
        <Cover title="Engineering" slot="E" owned={false} />
      </div>
    </main>
  );
}
