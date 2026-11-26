"use client";

import Form from "next/form";
import { useState } from "react";
import forms from "@/components/forms.module.css";
import styles from "./page.module.css";

type BookOption = { id: string; title: string; author: string | null };

/**
 * Picks which owned book an uploaded audiobook belongs to. Keeps "Choose" disabled until
 * a book is actually selected so pressing it never fails silently.
 */
export function AudiobookPicker({ books, chosenId }: { books: BookOption[]; chosenId: string }) {
  const [selected, setSelected] = useState(chosenId);
  return (
    <Form action="/import#audio-h" className={styles.choose}>
      <label htmlFor="audio-book" className={forms.label}>
        Book
      </label>
      <select
        id="audio-book"
        name="book"
        className={`${forms.input} ${styles.select}`}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        required
      >
        <option value="" disabled>
          Choose one of your books
        </option>
        {books.map((b) => (
          <option key={b.id} value={b.id}>
            {b.author ? `${b.title}, by ${b.author}` : b.title}
          </option>
        ))}
      </select>
      <button type="submit" className={styles.button} disabled={!selected}>
        Choose
      </button>
    </Form>
  );
}
