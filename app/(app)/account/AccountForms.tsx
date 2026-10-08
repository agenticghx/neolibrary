"use client";

import { useActionState } from "react";
import forms from "@/components/forms.module.css";
import { changePasswordAction, endOtherSessionsAction, type AccountState } from "../actions";
import styles from "./page.module.css";

const empty: AccountState = { error: null, done: null };

/** Change the password, or sign out of every browser except this one. */
export function AccountForms() {
  const [password, change, changing] = useActionState(changePasswordAction, empty);
  const [sessions, endOthers, ending] = useActionState(endOtherSessionsAction, empty);
  return (
    <>
      <section className={styles.card} aria-labelledby="password">
        <h2 id="password" className={styles.cardTitle}>
          Change password
        </h2>
        <p className={styles.cardText}>The new password needs at least 10 characters. Other browsers stay signed in.</p>
        <form action={change} className={forms.form}>
          <label className={forms.label} htmlFor="current-password">
            Current password
          </label>
          <input className={forms.input} id="current-password" name="current" type="password" autoComplete="current-password" required />
          <label className={forms.label} htmlFor="new-password">
            New password
          </label>
          <input
            className={forms.input}
            id="new-password"
            name="next"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
          />
          {password.error ? (
            <p className={forms.error} role="alert">
              {password.error}
            </p>
          ) : null}
          {password.done ? (
            <p className={styles.status} role="status">
              {password.done}
            </p>
          ) : null}
          <button type="submit" className={forms.button} disabled={changing}>
            {changing ? "Changing password…" : "Change password"}
          </button>
        </form>
      </section>
      <section className={styles.card} aria-labelledby="sessions">
        <h2 id="sessions" className={styles.cardTitle}>
          Other sessions
        </h2>
        <p className={styles.cardText}>
          Sign out of every other browser that is still signed in to this account. This browser stays signed in. Sign out,
          in the account menu, ends this browser only.
        </p>
        <form action={endOthers} className={forms.form}>
          {sessions.done ? (
            <p className={styles.status} role="status">
              {sessions.done}
            </p>
          ) : null}
          <button type="submit" className={forms.button} disabled={ending}>
            {ending ? "Signing out…" : "Sign out of other sessions"}
          </button>
        </form>
      </section>
    </>
  );
}
