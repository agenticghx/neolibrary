import type { PathFormState } from "@/app/(app)/actions";
import forms from "@/components/forms.module.css";
import styles from "./PathForms.module.css";

/**
 * A form's result, read out politely (M14 step 5). Empty while the form
 * sends, so a result that repeats the last one still changes the line and
 * a screen reader reads it again.
 */
export function Outcome({ state, pending, testId }: { state: PathFormState; pending: boolean; testId?: string }) {
  return (
    <p role="status" className={!pending && state.error ? forms.error : styles.done} data-testid={testId}>
      {pending ? "" : (state.error ?? state.done ?? "")}
    </p>
  );
}
