import type { Metadata } from "next";
import Link from "next/link";
import forms from "@/components/forms.module.css";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { runningFocus } from "@/lib/library/focus-lock";
import { getBook } from "@/lib/library/paths";
import { getPreferences } from "@/lib/library/preferences";
import { signOutAction } from "../actions";
import { AccountForms } from "./AccountForms";
import { ReadingPreferences } from "./ReadingPreferences";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

/** Reading preferences, the password and other browsers for the signed-in person. */
export default async function AccountPage() {
  const user = await requireUser();
  const db = await getDb();
  const preferences = await getPreferences(db, user.id);
  // M26 R4a: while a focus session runs, this is the one page besides the book that opens. On a phone the account
  // menu (with Sign out) is on Home, which sends you to the book, so Sign out is offered here. Signing out does not
  // end the session.
  const focus = await runningFocus(db, user.id);
  const focusBook = focus ? await getBook(db, user.id, focus.bookId) : null;
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>You</p>
      <h1 className={styles.title}>Account</h1>
      <p className={styles.lede}>
        Signed in as {user.name} ({user.email}).
      </p>
      {focus ? (
        <section className={styles.card} aria-labelledby="focus-running" data-testid="account-focus">
          <h2 id="focus-running" className={styles.cardTitle}>
            A focus session is running
          </h2>
          <p className={styles.cardText}>
            Until it ends, the other pages send you back to {focusBook ? <cite>{focusBook.book.title}</cite> : "your book"}. Signing out does not end it.
          </p>
          <Link className={styles.cardLink} href={`/books/${focus.bookId}/read`}>
            Back to the book
          </Link>
          <form action={signOutAction}>
            <button type="submit" className={forms.button}>
              Sign out
            </button>
          </form>
        </section>
      ) : null}
      <ReadingPreferences initial={preferences} />
      <AccountForms />
    </main>
  );
}
