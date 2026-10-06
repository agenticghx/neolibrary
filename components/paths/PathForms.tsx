"use client";

import { startTransition, useActionState, useEffect, useId, useRef } from "react";
import { addSectionAction, addTitleAction, createPathAction, renamePathAction, type PathFormState } from "@/app/(app)/actions";
import forms from "@/components/forms.module.css";
import { KIND_CHOICES } from "@/lib/library/path-words";
import { Outcome } from "./Outcome";
import styles from "./PathForms.module.css";

const start: PathFormState = { error: null, done: null };

/**
 * Runs a Path form's server action (M14 step 5). It submits through
 * onSubmit, not <form action>: React empties a form after its action runs,
 * even when the server refused it, and the reader would have to type
 * everything again. One send at a time; the pressed button stays enabled
 * (aria-disabled while sending), so keyboard focus stays on it. After a
 * success the fields are cleared, unless `keep` (the name form keeps them).
 */
function usePathForm(action: (state: PathFormState, data: FormData) => Promise<PathFormState>, keep = false) {
  const [state, dispatch, pending] = useActionState(action, start);
  const form = useRef<HTMLFormElement>(null);
  const sending = useRef(false);
  useEffect(() => {
    if (!pending) sending.current = false;
  }, [pending, state]);
  useEffect(() => {
    if (!keep && state.done && !state.error) form.current?.reset();
  }, [state, keep]);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || sending.current) return;
    sending.current = true;
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  return { state, pending, form, onSubmit };
}

/** Name a new Path (M14 step 5); it opens for editing. */
export function NewPathForm() {
  const { state, pending, form, onSubmit } = usePathForm(createPathAction);
  return (
    <form ref={form} onSubmit={onSubmit} className={forms.form}>
      <label className={forms.label} htmlFor="path-title">
        Name
      </label>
      <input id="path-title" name="title" className={forms.input} maxLength={120} placeholder="e.g. Philosophy of science" required autoFocus />
      <label className={forms.label} htmlFor="path-description">
        What it is for (optional)
      </label>
      <textarea id="path-description" name="description" className={forms.input} rows={3} maxLength={2000} />
      <button type="submit" className={forms.button} aria-disabled={pending || undefined}>
        Make the path
      </button>
      <Outcome state={state} pending={pending} />
    </form>
  );
}

export function RenamePathForm({ pathId, slug, title, description }: { pathId: string; slug: string; title: string; description: string }) {
  const { state, pending, form, onSubmit } = usePathForm(renamePathAction, true);
  return (
    <form ref={form} onSubmit={onSubmit} className={forms.form}>
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
      <button type="submit" className={forms.button} aria-disabled={pending || undefined}>
        Save
      </button>
      <Outcome state={state} pending={pending} />
    </form>
  );
}

export function AddSectionForm({ pathId, slug }: { pathId: string; slug: string }) {
  const { state, pending, form, onSubmit } = usePathForm(addSectionAction);
  const id = useId();
  return (
    <form ref={form} onSubmit={onSubmit} className={styles.inline}>
      <input type="hidden" name="pathId" value={pathId} />
      <input type="hidden" name="slug" value={slug} />
      <label className={forms.label} htmlFor={id}>
        New section
      </label>
      <div className={styles.row}>
        <input id={id} name="title" className={forms.input} maxLength={120} placeholder="e.g. Revolutions" required />
        <button type="submit" className={styles.small} aria-disabled={pending || undefined}>
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
  const { state: libraryState, pending: libraryPending, form: libraryForm, onSubmit: onLibrarySubmit } = usePathForm(addTitleAction);
  const { state: newState, pending: newPending, form: newForm, onSubmit: onNewSubmit } = usePathForm(addTitleAction);
  const id = useId();
  return (
    <div className={styles.addTitle}>
      {library.length ? (
        <form ref={libraryForm} onSubmit={onLibrarySubmit} className={styles.inline} aria-label={`Add a book from your library to ${sectionTitle}`}>
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
            <button type="submit" className={styles.small} aria-disabled={libraryPending || undefined}>
              Add<span className="visually-hidden">{` a book from your library to ${sectionTitle}`}</span>
            </button>
          </div>
          <Outcome state={libraryState} pending={libraryPending} />
        </form>
      ) : null}
      <form ref={newForm} onSubmit={onNewSubmit} className={styles.inline} aria-label={`Add a new title to ${sectionTitle}`}>
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
          <button type="submit" className={styles.small} aria-disabled={newPending || undefined}>
            Add<span className="visually-hidden">{` a new title to ${sectionTitle}`}</span>
          </button>
        </div>
        <Outcome state={newState} pending={newPending} />
      </form>
    </div>
  );
}
