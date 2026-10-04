"use client";

import { useActionState } from "react";
import forms from "@/components/forms.module.css";
import { createTokenAction, type TokenState } from "../actions";
import styles from "../admin/invites/page.module.css";

export function TokenForm() {
  const [state, action, pending] = useActionState<TokenState, FormData>(createTokenAction, { error: null, token: null });
  return (
    <div className={styles.create}>
      <form action={action} className={forms.form}>
        <label className={forms.label} htmlFor="token-name">
          Which agent is it for? (only you see this)
        </label>
        <input className={forms.input} id="token-name" name="name" maxLength={100} required placeholder="e.g. Claude on my laptop" />
        {state.error ? (
          <p className={forms.error} role="alert">
            {state.error}
          </p>
        ) : null}
        <button type="submit" className={forms.button} disabled={pending}>
          {pending ? "Making token…" : "Make a token"}
        </button>
      </form>
      {state.token ? (
        <div className={styles.link} role="status">
          <p className={styles.linkLabel}>
            Copy it now: it is shown only once. Anyone with it can read and add notes as you, so keep it as private as a
            password.
          </p>
          <input className={forms.input} readOnly value={state.token} aria-label="New API token" data-testid="new-token" />
          <button type="button" className={styles.copy} onClick={() => navigator.clipboard?.writeText(state.token!)}>
            Copy token
          </button>
        </div>
      ) : null}
    </div>
  );
}
