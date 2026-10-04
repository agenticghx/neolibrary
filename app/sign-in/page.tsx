import type { Metadata } from "next";
import { Mark } from "@/components/Mark";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
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

        <h1 className={styles.title}>Welcome back</h1>

        <form className={styles.form} aria-describedby="signin-note">
          <label className={styles.label} htmlFor="email">
            Email address
          </label>
          <input
            className={styles.input}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
          <button className={styles.button} type="submit" disabled>
            Send sign-in link
          </button>
          <p className={styles.note} id="signin-note">
            Use the email your invitation was sent to. Sign-in opens soon.
          </p>
        </form>
      </div>
    </main>
  );
}
