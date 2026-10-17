"use client";

import { useEffect, useState } from "react";
import { VoiceRecorder } from "@/components/notes/VoiceRecorder";
import type { Attempt, Item } from "@/lib/library/explain-back";
import { StudyTabs, type StudyTab } from "./StudyTabs";
import own from "./ExplainPanel.module.css";
import styles from "./reader.module.css";

type Anchor = { cfi: string; quote: { exact: string; prefix: string; suffix: string } };
type Data = {
  chapter: { id: string; label: string };
  anchor: Anchor;
  attempts: Attempt[];
  estimate: number | null;
  fake: boolean;
};

// The server's rule, repeated so the button waits for enough words (the server checks again).
const MIN_WORDS = 8;
const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
// On a phone the panel covers the page, so going to a line closes it (the answer is there on reopening).
const PHONE = "(width <= 48rem)";
const LABEL: Record<Item["kind"], string> = { missed: "Missed", misread: "Not quite" };

/**
 * Explain it back (M26 R1): at the end of a part, the reader says or types what it argued; only then does AI point
 * to what the summary missed or got wrong, each with the book's own words and a link to the place. The reader writes
 * first: no answer is shown, or asked for, before a summary. Three looks, as in Ask: the reader's words in italic
 * serif, the machine-written box tinted and labelled, the book's words in book serif.
 */
export function ExplainPanel({
  bookId,
  cfi,
  onTab,
  onGo,
  onSaved,
}: {
  bookId: string;
  cfi: string;
  onTab: (tab: StudyTab) => void;
  onGo: (cfi: string, close: boolean) => void;
  /** A note was added (the summary, or a spoken one): the reader's notes are read again, so Notes shows it. */
  onSaved: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOnly, setSavedOnly] = useState<string | null>(null);
  const [reused, setReused] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/books/${bookId}/explain-back?cfi=${encodeURIComponent(cfi)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) return setError(body.error ?? "Explain it back could not be opened.");
        setData(body);
      })
      .catch(() => live && setError("Explain it back could not be opened."));
    return () => {
      live = false;
    };
  }, [bookId, cfi]);

  const check = async () => {
    if (!data || busy || words(summary) < MIN_WORDS) return;
    setBusy(true);
    setError(null);
    setSavedOnly(null);
    try {
      const res = await fetch(`/api/books/${bookId}/explain-back`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterId: data.chapter.id, summary }),
      });
      const body = (await res.json().catch(() => ({}))) as { note?: unknown; attempt?: Attempt | null; reused?: boolean; error?: string | null };
      if (body.note) onSaved();
      if (body.note && !body.attempt) {
        // The summary is kept as a note; only the answer is missing.
        setSavedOnly(body.error ?? "AI could not answer this time.");
        setSummary("");
        return;
      }
      if (!res.ok || !body.attempt) throw new Error(body.error ?? "That did not work. Try again.");
      const attempt = body.attempt;
      setData((d) => (d ? { ...d, attempts: [attempt, ...d.attempts.filter((a) => a.id !== attempt.id)] } : d));
      setReused(Boolean(body.reused));
      setSummary("");
      setHeard(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Speaking: the recording is saved as a voice note on this part (nothing said is lost), and its words fill the box
  // for the reader to check before pressing Check.
  const saveSpoken = async (audio: Blob, durationMs: number) => {
    if (!data) return;
    const form = new FormData();
    form.set("audio", audio, "explain-back");
    form.set("cfi", data.anchor.cfi);
    form.set("quote", JSON.stringify(data.anchor.quote));
    form.set("durationMs", String(Math.round(durationMs)));
    const res = await fetch(`/api/books/${bookId}/voice-notes`, { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as { annotation?: { voice?: { transcript?: string } }; error?: string };
    if (!res.ok) throw new Error(body.error ?? "The recording was not saved.");
    onSaved();
    const said = body.annotation?.voice?.transcript?.trim() ?? "";
    setSpeaking(false);
    setHeard(said ? "Your recording is saved as a voice note. Check its words below, then press Check my summary." : "Your recording is saved as a voice note, but its words could not be written out. Type your summary instead.");
    if (said) setSummary((s) => (s.trim() ? `${s.trim()} ${said}` : said));
  };

  const go = (item: Item) => onGo(item.cfi, window.matchMedia(PHONE).matches);
  const [latest, ...earlier] = data?.attempts ?? [];
  const enough = words(summary) >= MIN_WORDS;

  return (
    <section className={styles.panel} aria-label="Explain it back">
      <p className={styles.panelTitle}>Explain it back</p>
      <StudyTabs current="explain" onPick={onTab} />
      {data ? <p className={own.part}>{data.chapter.label || "This part"}</p> : null}
      <form
        className={own.form}
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <label htmlFor="explain-summary" className={styles.groupLabel}>
          In your own words: what did this part argue?
        </label>
        <textarea
          id="explain-summary"
          className={own.summary}
          rows={5}
          maxLength={2000}
          value={summary}
          placeholder="About three sentences, before you look anything up."
          aria-describedby="explain-how"
          onChange={(e) => setSummary(e.target.value)}
        />
        <p id="explain-how" className={styles.hint}>
          Your summary is saved as a note first. Then AI points to what it missed or got wrong, quoting the book.
        </p>
        {heard ? (
          <p className={styles.hint} role="status">
            {heard}
          </p>
        ) : null}
        {speaking ? (
          <VoiceRecorder onSave={saveSpoken} onBack={() => setSpeaking(false)} />
        ) : data ? (
          <button type="button" className={styles.linkButton} onClick={() => setSpeaking(true)}>
            Say it instead
          </button>
        ) : null}
        {!data && !error ? <p className={styles.hint}>Opening…</p> : null}
        {data && data.estimate === null ? (
          <p className={styles.hint}>AI is not set up yet: your summary is still saved as a note, but nothing checks it.</p>
        ) : null}
        {data ? (
          <div className={styles.noteActions}>
            <button type="submit" className={styles.primaryTool} disabled={busy || !enough}>
              {busy ? "Reading your summary…" : data.estimate === null ? "Save my summary" : `Check my summary (${usd(data.estimate)})`}
            </button>
          </div>
        ) : null}
        {data && summary.trim() && !enough ? (
          <p className={styles.hint}>A few more words: at least {MIN_WORDS}.</p>
        ) : null}
      </form>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      {savedOnly ? (
        <p className={styles.hint} role="status">
          Your summary is saved as a note. {savedOnly}
        </p>
      ) : null}
      {latest ? <AttemptView attempt={latest} fake={Boolean(data?.fake)} reused={reused} onGo={go} /> : null}
      {earlier.length ? (
        <details className={own.earlier}>
          <summary>Earlier tries ({earlier.length})</summary>
          {earlier.map((a) => (
            <AttemptView key={a.id} attempt={a} fake={Boolean(data?.fake)} reused={false} onGo={go} />
          ))}
        </details>
      ) : null}
    </section>
  );
}

function AttemptView({ attempt, fake, reused, onGo }: { attempt: Attempt; fake: boolean; reused: boolean; onGo: (item: Item) => void }) {
  return (
    <div className={own.attempt} data-testid="explain-attempt">
      <p className={own.wrote}>
        <span className="visually-hidden">You wrote: </span>“{attempt.summary}”
      </p>
      <aside className={styles.machine} aria-label="Machine-written check of your summary">
        <p className={styles.machineLabel}>What your summary missed · written by {fake ? "the test AI" : "AI"}</p>
        {attempt.items.length ? (
          <ol className={own.items}>
            {attempt.items.map((item, i) => (
              <li key={i} className={own.item}>
                <span className={own.kind} data-kind={item.kind}>
                  {LABEL[item.kind]}
                </span>
                <button type="button" className={own.line} onClick={() => onGo(item)}>
                  {item.quote ? (
                    <span className={own.quote}>“{item.quote}”</span>
                  ) : (
                    <span className={own.quote}>
                      <span className={own.marker}>The passage begins: </span>
                      {item.excerpt}
                    </span>
                  )}
                  <span className="visually-hidden"> (go to this place)</span>
                </button>
                <span className={own.why}>{item.why}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>Nothing missed: your summary covers this part’s main ideas and gets nothing wrong.</p>
        )}
        <p className={styles.provenance}>
          {attempt.provenance.model} · {when(attempt.provenance.createdAt)} · ${attempt.provenance.costUsd.toFixed(attempt.provenance.costUsd < 0.01 ? 4 : 2)}
          {reused ? " · checked before, so this time free" : ""}
        </p>
      </aside>
    </div>
  );
}
