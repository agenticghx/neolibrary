"use client";

import { useEffect, useRef, useState } from "react";
import { shortTitle, surnameOf } from "@/lib/covers/match";
import { catalogueName } from "@/lib/covers/names";
import type { ShownChoice } from "@/lib/library/cover-lookup";
import styles from "./page.module.css";

export type Choosing = { id: string; title: string; author: string };

/**
 * "Choose a cover" (C3a): a modal dialog that searches the catalogues for the words the reader types (the title and
 * the author's surname to start, searched at once) and shows every result with a picture, whatever its title and
 * author: the reader judges by eye. "Use this cover" makes it the title's cover; or the reader's own picture
 * (C3b). Escape or Close shuts it, and the keyboard goes back to the button that opened it (or to the page's status
 * line, when that title has moved).
 */
export function ChooseCover({ book, onDone, onClose }: { book: Choosing; onDone: (line: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [words, setWords] = useState(() => `${shortTitle(book.title)} ${surnameOf(book.author)}`.trim());
  const [choices, setChoices] = useState<ShownChoice[]>([]);
  // The first search starts as the dialog opens.
  const [line, setLine] = useState("Searching…");
  const [busy, setBusy] = useState<"search" | "use" | null>("search");
  const [own, setOwn] = useState<File | null>(null);

  function search(q: string) {
    if (!q.trim()) {
      setLine("Type a title or an author to search for.");
      return;
    }
    setBusy("search");
    setLine("Searching…");
    void results(q);
  }

  /** Asks the server, then shows what came back (state is set only once the answer is in). */
  async function results(q: string) {
    const res = await fetch(`/api/covers/search?q=${encodeURIComponent(q)}`).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { choices?: ShownChoice[]; unreachable?: string[]; error?: string }) : {};
    setBusy(null);
    if (!res || !res.ok) {
      setLine(body.error ?? "Could not search just now. Try again in a moment.");
      return;
    }
    const found = body.choices ?? [];
    const missed = (body.unreachable ?? []).join(" ");
    setChoices(found);
    setLine(
      found.length
        ? `${found.length} ${found.length === 1 ? "picture" : "pictures"} found.${missed ? ` ${missed}` : ""}`
        : missed
          ? `${missed} Try again in a moment.`
          : "Nothing with a cover for these words. Try other words: the title as a catalogue might spell it, or a writer’s name.",
    );
  }

  async function use(c: ShownChoice) {
    setBusy("use");
    setLine(`Using the cover of “${c.title}”…`);
    const res = await fetch(`/api/covers/${book.id}/choose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice: c.choice }),
    }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    if (!res || !res.ok) {
      setBusy(null);
      setLine(body.error ?? "Could not use that cover just now. Try again in a moment.");
      return;
    }
    onDone(`“${book.title}”: the cover you chose is shown.`);
  }

  async function upload(file: File) {
    setBusy("use");
    setLine("Using your picture…");
    const res = await fetch(`/api/covers/${book.id}/upload`, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    if (!res || !res.ok) {
      setBusy(null);
      setLine(body.error ?? "Could not use that picture just now. Try again in a moment.");
      return;
    }
    onDone(`“${book.title}”: your picture is its cover.`);
  }

  useEffect(() => {
    const d = dialog.current;
    const back = document.activeElement as HTMLElement | null;
    d?.showModal();
    input.current?.focus();
    void results(words);
    return () => {
      d?.close();
      if (back?.isConnected) back.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>("[data-testid='reject-status']")?.focus({ preventScroll: true });
    };
    // Opened once per title: the first search uses the words it opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={dialog}
      className={`${styles.chooser} glass-card`}
      aria-modal="true"
      aria-labelledby="choose-title"
      // The browser's own close request (Escape, a phone's back gesture): closed through React, so focus goes back.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Escape in the search box would only empty it (a search box's own use of Escape): it closes the dialog here.
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onClose();
      }}
    >
      <div className={styles.chooserHead}>
        <h2 id="choose-title" className={styles.sectionTitle}>
          Choose a cover
        </h2>
        <button type="button" className={styles.reject} onClick={onClose}>
          Close
        </button>
      </div>
      <p className={styles.note}>
        For <cite className={styles.listTitle}>{book.title}</cite>
        {book.author ? ` · ${book.author}` : ""}. Any result with a picture is shown, whatever its title: choose the one that is this book.
      </p>
      <form
        role="search"
        className={styles.chooserSearch}
        onSubmit={(e) => {
          e.preventDefault();
          search(words);
        }}
      >
        <label htmlFor="choose-words" className={styles.chooserLabel}>
          Search the catalogues
        </label>
        <input
          ref={input}
          id="choose-words"
          type="search"
          className={styles.chooserInput}
          value={words}
          onChange={(e) => setWords(e.target.value)}
          maxLength={200}
          autoComplete="off"
        />
        <button type="submit" className={styles.findButton} disabled={busy !== null}>
          Search
        </button>
      </form>
      <p className={styles.status} aria-live="polite" data-testid="choose-status">
        {line}
      </p>
      <ul className={styles.choices} data-testid="cover-choices" aria-busy={busy === "search"}>
        {choices.map((c) => (
          <li key={c.choice} className={styles.item}>
            {/* A data: address: the preview came back with the search (the site shows no other site's pictures). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.preview} alt={`Cover of ${c.title}`} className={styles.picture} />
            <p className={styles.itemTitle}>{c.title}</p>
            <p className={styles.itemAuthor}>{[c.authors.join(", "), c.year].filter(Boolean).join(" · ")}</p>
            <p className={styles.itemSource}>From {catalogueName(c.source)}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.reject} onClick={() => use(c)} disabled={busy !== null} aria-label={`Use this cover: ${c.title}`}>
                Use this cover
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className={styles.chooserOwn}>
        <h3 className={styles.chooserOwnTitle}>Or use your own picture</h3>
        <div className={styles.chooserSearch}>
          <label htmlFor="choose-file" className={styles.chooserLabel}>
            A JPEG, PNG or WebP picture of the cover, at most 3 MB
          </label>
          <input
            id="choose-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className={styles.chooserFile}
            onChange={(e) => setOwn(e.target.files?.[0] ?? null)}
          />
          <button type="button" className={styles.reject} disabled={!own || busy !== null} onClick={() => own && upload(own)}>
            Use this picture
          </button>
        </div>
      </div>
    </dialog>
  );
}
