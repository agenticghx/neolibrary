import { Mark } from "./Mark";
import styles from "./AuthShell.module.css";

/** The quiet room around the sign-in, setup and invitation forms. */
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className={styles.room}>
      <div className={styles.panel}>
        <header className={styles.brand}>
          <span className={styles.mark}>
            <Mark size={56} />
          </span>
          <p className={styles.wordmark}>Neolibrary</p>
          <p className={styles.tagline}>By invitation only</p>
        </header>
        <h1 className={styles.title}>{title}</h1>
        {children}
      </div>
    </main>
  );
}
