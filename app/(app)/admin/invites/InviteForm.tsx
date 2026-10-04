"use client";

import { useActionState } from "react";
import forms from "@/components/forms.module.css";
import { createInviteAction, type InviteState } from "../../actions";
import styles from "./page.module.css";

export function InviteForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(createInviteAction, {
    error: null,
    link: null,
  });
  // A link only exists after the action ran in the browser, so window is defined.
  const full = state.link ? window.location.origin + state.link : null;

  return (
    <div className={styles.create}>
      <form action={action} className={forms.form}>
        <label className={forms.label} htmlFor="note">
          Who is it for? (only you see this)
        </label>
        <input className={forms.input} id="note" name="note" maxLength={200} placeholder="e.g. Ada, reading group" />
        <button type="submit" className={forms.button} disabled={pending}>
          {pending ? "Making link…" : "Make an invitation link"}
        </button>
      </form>
      {full ? (
        <div className={styles.link} role="status">
          <p className={styles.linkLabel}>Send this link. It works once, for 7 days, and is shown only now.</p>
          <input className={forms.input} readOnly value={full} aria-label="Invitation link" data-testid="invite-link" />
          <button type="button" className={styles.copy} onClick={() => navigator.clipboard?.writeText(full)}>
            Copy link
          </button>
        </div>
      ) : null}
    </div>
  );
}
