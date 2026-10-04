import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { ImportForm } from "./ImportForm";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Your data" };

export default async function DataPage() {
  await requireUser();
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Your data</p>
      <h1 className={styles.title}>No lock-in</h1>
      <p className={styles.lede}>
        Everything in your library can leave with you. The file holds your books&apos; details, your paths and your
        collections; the book files themselves stay where you uploaded them.
      </p>
      <section className={styles.card} aria-labelledby="export">
        <h2 id="export" className={styles.cardTitle}>
          Take it with you
        </h2>
        <p className={styles.cardText}>A single JSON file you can keep, read or bring back later.</p>
        <a href="/api/export" className={styles.button}>
          Download your library
        </a>
      </section>
      <section className={styles.card} aria-labelledby="import">
        <h2 id="import" className={styles.cardTitle}>
          Bring it back
        </h2>
        <p className={styles.cardText}>Works into an empty library, so nothing you have is ever overwritten.</p>
        <ImportForm />
      </section>
      <section className={styles.card} aria-labelledby="agents">
        <h2 id="agents" className={styles.cardTitle}>
          Let an agent use it
        </h2>
        <p className={styles.cardText}>Tokens for AI agents, which you can revoke at any time.</p>
        <Link href="/agents" className={styles.button}>
          Agent access
        </Link>
      </section>
    </main>
  );
}
