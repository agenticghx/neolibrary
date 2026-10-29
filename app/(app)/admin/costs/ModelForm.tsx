"use client";

import { useActionState } from "react";
import forms from "@/components/forms.module.css";
import { setModelPicksAction, type ModelPickState } from "../../actions";
import own from "./page.module.css";

export type ModelRow = { feature: string; label: string; fallback: string; picked: string | null };
export type ModelChoice = { id: string; name: string; price: string };

/** One menu per AI feature: its default, or a model the owner picks (M35). */
export function ModelForm({ rows, choices }: { rows: ModelRow[]; choices: ModelChoice[] }) {
  const [state, action, pending] = useActionState<ModelPickState, FormData>(setModelPicksAction, { error: null, done: null });
  const name = (id: string) => choices.find((c) => c.id === id)?.name ?? id;
  return (
    <form action={action} className={own.models} data-testid="model-form">
      {rows.map((r) => (
        <div key={r.feature} className={own.modelRow}>
          <label htmlFor={`model-${r.feature}`} className={own.modelLabel}>
            {r.label}
          </label>
          <select
            id={`model-${r.feature}`}
            name={r.feature}
            className={`${forms.input} ${own.select}`}
            defaultValue={r.picked ?? "default"}
            data-testid={`model-${r.feature}`}
          >
            <option value="default">Default ({name(r.fallback)})</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.price}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className={own.modelSave}>
        <button type="submit" className={forms.button} disabled={pending}>
          {pending ? "Saving…" : "Save models"}
        </button>
        {state.error ? (
          <p className={forms.error} role="alert">
            {state.error}
          </p>
        ) : null}
        {state.done ? (
          <p className={own.meta} role="status">
            {state.done}
          </p>
        ) : null}
      </div>
    </form>
  );
}
