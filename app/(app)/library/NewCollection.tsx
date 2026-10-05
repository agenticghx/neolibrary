"use client";

import { useActionState, useState } from "react";
import { createCollectionAction, type CollectionState } from "../actions";
import styles from "./page.module.css";

export function NewCollection() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CollectionState, FormData>(createCollectionAction, { error: null });
  if (!open)
    return (
      <button type="button" className={styles.chipAdd} onClick={() => setOpen(true)}>
        + New collection
      </button>
    );
  return (
    <form action={action} className={styles.newCollection}>
      <label className="visually-hidden" htmlFor="collection-name">
        Collection name
      </label>
      <input
        id="collection-name"
        name="name"
        className={styles.newCollectionInput}
        placeholder="e.g. Gothic novels"
        maxLength={60}
        autoFocus
        required
      />
      <button type="submit" className={styles.chipAdd} disabled={pending}>
        Create
      </button>
      {state.error ? (
        <span role="alert" className={styles.inlineError}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
