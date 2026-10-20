"use client";

import { useState } from "react";
import type { Attempt } from "@/lib/library/explain-back";
import type { WhereWereWe } from "@/lib/library/where-were-we";
import own from "./WhereWereWe.module.css";
import styles from "./reader.module.css";

// The server's rule, repeated so Save waits for enough words (the server checks again).
const MIN_WORDS = 8;
const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/** Skip hides it for the rest of the day (UTC, as the server counts days) on this device. */
const skipKey = (bookId: string) => `nl:where-were-we:${bookId}:${new Date().toISOString().slice(0, 10)}`;

function skippedToday(bookId: string) {
  try {
    return Boolean(localStorage.getItem(skipKey(bookId)));
  } catch {
    return false; // storage blocked: the strip shows, and Skip hides it until the page is opened again
  }
}

type Saved = { attempt: Attempt | null; error: string | null };

/**
 * "Where were we?" (M28 S3): back in a book on a later day, a strip above the page asks what the reader remembers of
 * the chapter they were in. One line until they choose to write, so it never stands between them and the page:
 * they can write a few sentences (sent to Explain it back for that chapter, saved as their note first), press Skip,
 * or just read on. The reader writes first; what Claude says they missed is one tap away, in Study.
 */
export function WhereWereWeStrip({ bookId, recall, onSeeMissed, onSaved }: { bookId: string; recall: WhereWereWe; onSeeMissed: () => void; onSaved: () => void }) {
  // Mounted only in the browser, once the book is open (never on the server), so storage can be read at once.
  const [state, setState] = useState<"asking" | "writing" | "saving" | "saved" | "hidden">(() => (skippedToday(bookId) ? "hidden" : "asking"));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  const skip = () => {
    try {
      localStorage.setItem(skipKey(bookId), "1");
    } catch {
      // As above.
    }
    setState("hidden");
  };

  const save = async () => {
    setState("saving");
    setError(null);
    const res = await fetch(`/api/books/${bookId}/explain-back`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapterId: recall.chapterId, summary: text }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { note?: unknown; attempt?: Attempt | null; error?: string | null } | null;
    if (!res || !data || (!res.ok && !data.note)) {
      setError(data?.error ?? "That was not saved. Check the connection and try again.");
      setState("writing");
      return;
    }
    // Saved as the reader's note; Claude's answer may be missing (no AI set up, a spending cap): the note stays.
    setSaved({ attempt: data.attempt ?? null, error: data.attempt ? null : (data.error ?? null) });
    setState("saved");
    onSaved();
  };

  if (state === "hidden") return null;
  const label = recall.label || "this part";
  const missed = saved?.attempt?.items.length ?? 0;
  return (
    <section className={own.strip} aria-label="Where were we?" data-testid="where-were-we">
      {state === "asking" ? (
        <>
          <p className={own.ask}>
            Last time you were reading <cite className={own.chapter}>{label}</cite>. What do you remember?
          </p>
          <div className={own.actions}>
            <button type="button" className={styles.primaryTool} onClick={() => setState("writing")}>
              Write it
            </button>
            <button type="button" className={styles.tool} onClick={skip}>
              Skip
            </button>
          </div>
        </>
      ) : state === "saved" ? (
        <>
          <p className={own.ask} role="status">
            Saved as your summary of <cite className={own.chapter}>{label}</cite>.{" "}
            {saved?.attempt
              ? missed
                ? `Claude found ${missed === 1 ? "one thing" : `${missed} things`} you missed. ${missed === 1 ? "It comes" : "They come"} back in Daily review.`
                : "Claude found nothing missing."
              : (saved?.error ?? "")}
          </p>
          <div className={own.actions}>
            {saved?.attempt && missed ? (
              <button
                type="button"
                className={styles.primaryTool}
                onClick={() => {
                  setState("hidden");
                  onSeeMissed();
                }}
              >
                See what you missed
              </button>
            ) : null}
            <button type="button" className={styles.tool} onClick={() => setState("hidden")}>
              Close
            </button>
          </div>
        </>
      ) : (
        <form
          className={own.form}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className={own.ask} htmlFor="where-were-we-text">
            What do you remember of <cite className={own.chapter}>{label}</cite>? A few sentences, in your own words, before you look.
          </label>
          <textarea
            id="where-were-we-text"
            className={own.text}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={state === "saving"}
            autoFocus
          />
          {error ? (
            <p role="alert" className={own.error}>
              {error}
            </p>
          ) : null}
          <div className={own.actions}>
            <button type="submit" className={styles.primaryTool} disabled={state === "saving" || words(text) < MIN_WORDS}>
              {state === "saving" ? "Saving…" : "Save"}
            </button>
            <button type="button" className={styles.tool} onClick={skip} disabled={state === "saving"}>
              Skip
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
