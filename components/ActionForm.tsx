"use client";

import { startTransition, useActionState } from "react";
import styles from "./forms.module.css";

export type FormState = { error: string | null };

/** A form that runs a server action and shows its error message, if any. */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  children,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel?: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  // Submit through onSubmit instead of <form action>, because React clears a
  // form after its action runs; after a wrong password the email must stay.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  return (
    <form onSubmit={onSubmit} className={styles.form}>
      {children}
      {state.error ? (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      ) : null}
      <button className={styles.button} type="submit" disabled={pending}>
        {pending ? (pendingLabel ?? submitLabel) : submitLabel}
      </button>
    </form>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  placeholder,
  minLength,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  minLength?: number;
  defaultValue?: string;
}) {
  return (
    <>
      <label className={styles.label} htmlFor={name}>
        {label}
      </label>
      <input
        className={styles.input}
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        defaultValue={defaultValue}
        required
      />
    </>
  );
}
