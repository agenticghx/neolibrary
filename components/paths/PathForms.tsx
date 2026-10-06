"use client";

import { useActionState, useId } from "react";
import { addSectionAction, addTitleAction, createPathAction, renamePathAction, type PathFormState } from "@/app/(app)/actions";
import forms from "@/components/forms.module.css";
import { KIND_CHOICES } from "@/lib/library/path-words";
import { Outcome } from "./Outcome";
import styles from "./PathForms.module.css";

const start: PathFormState = { error: null, done: null };

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
      <Outcome state={state} pending={pending} />
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
      <textarea id="rename-description" name="description" className={forms.input} rows={3} maxLength={2000} defaultValue={description} />
      <button type="submit" className={forms.button} disabled={pending}>
        Save name
      </button>
      <Outcome state={state} pending={pending} />
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
      <Outcome state={state} pending={pending} />
    </form>
  );
}

/** "How to read it": Story first, Go deeper or Any order (stored as N, E, extra). A visible label: the words need it. */
function HowToRead({ id }: { id: string }) {
  return (
    <div className={styles.field}>
      <label className={forms.label} htmlFor={id}>
        How to read it
      </label>
      <select id={id} name="kind" className={forms.input} defaultValue="extra">
        {KIND_CHOICES.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
    </div>
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
  library: { id: string; title: string; author: string }[];
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
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={forms.label} htmlFor={`${id}-book`}>
                From your library
              </label>
              <select id={`${id}-book`} name="bookId" className={forms.input} required defaultValue="">
                <option value="" disabled>
                  Choose a book
                </option>
                {library.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.author ? `${b.title}, by ${b.author}` : b.title}
                  </option>
                ))}
              </select>
            </div>
            <HowToRead id={`${id}-kind-l`} />
            <button type="submit" className={styles.small} disabled={pendingLibrary}>
              Add<span className="visually-hidden">{` a book from your library to ${sectionTitle}`}</span>
            </button>
          </div>
          <Outcome state={fromLibrary} pending={pendingLibrary} />
        </form>
      ) : null}
      <form action={addNew} className={styles.inline} aria-label={`Add a new title to ${sectionTitle}`}>
        <input type="hidden" name="pillarId" value={pillarId} />
        <input type="hidden" name="slug" value={slug} />
        <span className={forms.label}>A title not in your library yet</span>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={forms.label} htmlFor={`${id}-title`}>
              Title
            </label>
            <input id={`${id}-title`} name="title" className={forms.input} maxLength={120} required />
          </div>
          <div className={styles.field}>
            <label className={forms.label} htmlFor={`${id}-author`}>
              Author
            </label>
            <input id={`${id}-author`} name="author" className={forms.input} maxLength={120} />
          </div>
          <HowToRead id={`${id}-kind-n`} />
          <button type="submit" className={styles.small} disabled={pendingNew}>
            Add<span className="visually-hidden">{` a new title to ${sectionTitle}`}</span>
          </button>
        </div>
        <Outcome state={newTitle} pending={pendingNew} />
      </form>
    </div>
  );
}
