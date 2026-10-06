"use client";

import { useActionState, useId } from "react";
import { addSectionAction, addTitleAction, createPathAction, renamePathAction, type PathFormState } from "@/app/(app)/actions";
import forms from "@/components/forms.module.css";
import styles from "./PathForms.module.css";

const start: PathFormState = { error: null, done: null };

function Outcome({ state }: { state: PathFormState }) {
  return (
    <p role="status" className={state.error ? forms.error : styles.done}>
      {state.error ?? state.done ?? ""}
    </p>
  );
}

/** Name a new Path (M14 step 5); it opens for editing. */
export function NewPathForm() {
  const [state, action, pending] = useActionState(createPathAction, start);
  return (
    <form action={action} className={forms.form}>
      <label className={forms.label} htmlFor="path-title">
        Name
      </label>
      <input id="path-title" name="title" className={forms.input} maxLength={120} placeholder="e.g. Philosophy of science" required autoFocus />
      <label className={forms.label} htmlFor="path-description">
        What it is for (optional)
      </label>
      <textarea id="path-description" name="description" className={forms.input} rows={3} maxLength={2000} />
      <button type="submit" className={forms.button} disabled={pending}>
        Make the path
      </button>
      <Outcome state={state} />
    </form>
  );
}

export function RenamePathForm({ pathId, slug, title, description }: { pathId: string; slug: string; title: string; description: string }) {
  const [state, action, pending] = useActionState(renamePathAction, start);
  return (
    <form action={action} className={forms.form}>
      <input type="hidden" name="pathId" value={pathId} />
      <input type="hidden" name="slug" value={slug} />
      <label className={forms.label} htmlFor="rename-title">
        Name
      </label>
      <input id="rename-title" name="title" className={forms.input} maxLength={120} defaultValue={title} required />
      <label className={forms.label} htmlFor="rename-description">
        What it is for (optional)
      </label>
      <textarea id="rename-description" name="description" className={forms.input} rows={2} maxLength={2000} defaultValue={description} />
      <button type="submit" className={forms.button} disabled={pending}>
        Save name
      </button>
      <Outcome state={state} />
    </form>
  );
}

export function AddSectionForm({ pathId, slug }: { pathId: string; slug: string }) {
  const [state, action, pending] = useActionState(addSectionAction, start);
  const id = useId();
  return (
    <form action={action} className={styles.inline}>
      <input type="hidden" name="pathId" value={pathId} />
      <input type="hidden" name="slug" value={slug} />
      <label className={forms.label} htmlFor={id}>
        New section
      </label>
      <div className={styles.row}>
        <input id={id} name="title" className={forms.input} maxLength={120} placeholder="e.g. Revolutions" required />
        <button type="submit" className={styles.small} disabled={pending}>
          Add section
        </button>
      </div>
      <Outcome state={state} />
    </form>
  );
}

const KINDS = [
  ["N", "Story first"],
  ["E", "Go deeper"],
  ["extra", "Plain"],
] as const;

function KindSelect({ id }: { id: string }) {
  return (
    <select id={id} name="kind" className={forms.input} defaultValue="extra">
      {KINDS.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

/**
 * Add a title to a section: a book already in the library, or a new title
 * (name and author) that waits, greyed, until its file is added.
 */
export function AddTitleForms({
  pillarId,
  sectionTitle,
  slug,
  library,
}: {
  pillarId: string;
  sectionTitle: string;
  slug: string;
  library: { id: string; title: string }[];
}) {
  const [fromLibrary, addFromLibrary, pendingLibrary] = useActionState(addTitleAction, start);
  const [newTitle, addNew, pendingNew] = useActionState(addTitleAction, start);
  const id = useId();
  return (
    <div className={styles.addTitle}>
      {library.length ? (
        <form action={addFromLibrary} className={styles.inline} aria-label={`Add a book from your library to ${sectionTitle}`}>
          <input type="hidden" name="pillarId" value={pillarId} />
          <input type="hidden" name="slug" value={slug} />
          <label className={forms.label} htmlFor={`${id}-book`}>
            From your library
          </label>
          <div className={styles.row}>
            <select id={`${id}-book`} name="bookId" className={forms.input} required defaultValue="">
              <option value="" disabled>
                Choose a book
              </option>
              {library.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
            <label className="visually-hidden" htmlFor={`${id}-kind-l`}>
              Kind
            </label>
            <KindSelect id={`${id}-kind-l`} />
            <button type="submit" className={styles.small} disabled={pendingLibrary}>
              Add
            </button>
          </div>
          <Outcome state={fromLibrary} />
        </form>
      ) : null}
      <form action={addNew} className={styles.inline} aria-label={`Add a new title to ${sectionTitle}`}>
        <input type="hidden" name="pillarId" value={pillarId} />
        <input type="hidden" name="slug" value={slug} />
        <span className={forms.label}>A title not in your library yet</span>
        <div className={styles.row}>
          <label className="visually-hidden" htmlFor={`${id}-title`}>
            Title
          </label>
          <input id={`${id}-title`} name="title" className={forms.input} maxLength={120} placeholder="Title" required />
          <label className="visually-hidden" htmlFor={`${id}-author`}>
            Author
          </label>
          <input id={`${id}-author`} name="author" className={forms.input} maxLength={120} placeholder="Author" />
          <label className="visually-hidden" htmlFor={`${id}-kind-n`}>
            Kind
          </label>
          <KindSelect id={`${id}-kind-n`} />
          <button type="submit" className={styles.small} disabled={pendingNew}>
            Add
          </button>
        </div>
        <Outcome state={newTitle} />
      </form>
    </div>
  );
}
