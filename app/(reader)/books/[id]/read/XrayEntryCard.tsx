"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { KIND_LABELS, type XrayChapter, type XrayFact, type XrayListEntry } from "@/lib/library/xray";
import type { LibraryLink, WorldView } from "@/lib/library/xray-layers";
import styles from "./reader.module.css";
import own from "./XrayEntryCard.module.css";

type Layers = { library: LibraryLink[]; world: WorldView | null; estimate: number | null; fake: boolean; for: string };
const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);

/** The chapter the reader is in: the last one that starts at or before their place. */
export function chapterNow(chapters: XrayChapter[], position: number) {
  let now = -1;
  for (const c of chapters) if (c.position <= position) now = c.index;
  return now;
}

/**
 * One cell per chapter: darker where the name comes up more, the current chapter outlined, and a chapter the
 * reader has not reached drawn empty until "Show everything".
 */
export function Trail({ entry, chapters, position, showAll }: { entry: XrayListEntry; chapters: XrayChapter[]; position: number; showAll: boolean }) {
  const max = Math.max(1, ...entry.chapters.map((c) => c.count));
  const by = new Map(entry.chapters.map((c) => [c.index, c]));
  const now = chapterNow(chapters, position);
  return (
    <span className={own.trail} aria-hidden="true">
      {chapters.map((c) => {
        const m = by.get(c.index);
        const ahead = !showAll && c.position > position;
        const level = m ? (m.count >= max * 0.6 ? own.m3 : m.count >= max * 0.25 ? own.m2 : own.m1) : "";
        return <i key={c.index} className={[own.cell, ahead ? own.ahead : level, c.index === now ? own.now : ""].filter(Boolean).join(" ")} />;
      })}
    </span>
  );
}

/**
 * One name of the X-ray (M32): what it is, where it was first met, its trail, the other ways the book writes it,
 * and where it appears, each chapter a link to the first mention there. Shown inside Who & what (X1) and in the
 * card that opens from a name on the page (X2). Names only until Claude's reading (X3) adds facts.
 */
export function XrayEntryCard({
  bookId,
  entry,
  chapters,
  position,
  showAll,
  fake,
  onGo,
}: {
  bookId: string;
  entry: XrayListEntry;
  chapters: XrayChapter[];
  position: number;
  showAll: boolean;
  /** The answers came from the test AI (browser tests), not Claude. */
  fake?: boolean;
  onGo: (cfi: string, fact?: XrayFact) => void;
}) {
  // X4: the same name in the reader's other books, and what the world knows (asked for here, kept once asked).
  const [loaded, setLoaded] = useState<Layers | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/books/${bookId}/xray/entry?${new URLSearchParams({ entry: entry.id })}`)
      .then(async (res) => (res.ok ? ((await res.json()) as Omit<Layers, "for">) : null))
      .then((l) => live && l && setLoaded({ ...l, for: entry.id }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bookId, entry.id]);
  // The layers of the name shown; another name's, still in hand while this one's load, are not.
  const layers = loaded?.for === entry.id ? loaded : null;
  const askWorld = async () => {
    setAsking(true);
    setAskError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/xray/entry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entry: entry.id }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That did not work. Try again.");
      setLoaded((l) => (l && l.for === entry.id ? { ...l, world: body.world } : l));
    } catch (e) {
      setAskError((e as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const label = new Map(chapters.map((c) => [c.index, c.label]));
  const count = showAll ? entry.total : entry.soFar;
  /** X3: what Claude read, up to where the reader is unless everything is asked for. */
  const shown = entry.facts.filter((f) => showAll || f.seen);
  const factsAhead = entry.facts.length - shown.length;
  const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  /** Chapters with a mention that the reader has not reached: named by their number only, not by what they hold. */
  const ahead = entry.chapters.filter((c) => c.soFar === 0).length;
  return (
    <>
      <h3 className={own.name}>{entry.name}</h3>
      <p className={own.meta}>
        {entry.kind !== "name" ? <span>{KIND_LABELS[entry.kind]}</span> : null}
        {entry.firstChapter >= 0 ? <span>met in {label.get(entry.firstChapter) ?? "the book"}</span> : null}
        <span>
          {count} {count === 1 ? "mention" : "mentions"}
          {showAll ? "" : " so far"}
        </span>
      </p>
      <Trail entry={entry} chapters={chapters} position={position} showAll={showAll} />
      {entry.aliases.length > 1 ? <p className={styles.hint}>Also written {entry.aliases.filter((a) => a !== entry.name).join(", ")}.</p> : null}
      {entry.facts.length ? (
        <>
          <p className={own.factsHead}>
            <span className={styles.groupLabel}>From this book, up to here</span>
            {factsAhead ? <span className={own.factsAhead}>{factsAhead} more ahead</span> : null}
          </p>
          <aside className={`${styles.machine} ${own.facts}`} aria-label="What the book says" data-testid="xray-facts">
            <p className={styles.machineLabel}>Written by {fake ? "the test AI" : "AI"}, from the book’s words</p>
            {shown.length ? (
              <ol className={own.factList}>
                {shown.map((f) => (
                  <li key={f.id} className={own.fact}>
                    <span className={own.factChapter}>{label.get(f.chapterIndex) ?? `Part ${f.chapterIndex + 1}`}</span>
                    <span>{f.fact}</span>
                    <button type="button" className={own.quote} onClick={() => onGo(f.cfi, f)} title="Open this place in the book">
                      “{f.quote}”
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>Nothing yet: the book has not said anything about this up to here.</p>
            )}
            {shown.length ? (
              <p className={styles.provenance}>
                {shown[0].model} · {when(shown[0].readAt)}
              </p>
            ) : null}
          </aside>
        </>
      ) : null}
      <p className={styles.groupLabel}>From your library</p>
      {layers === null ? (
        <p className={styles.hint}>Looking in your other books…</p>
      ) : layers.library.length ? (
        <ul className={own.places} data-testid="xray-library">
          {layers.library.map((l) => (
            <li key={`${l.bookId}|${l.entryId}`} className={own.libraryItem}>
              <span>
                <span className={own.libraryTitle}>{l.title}</span>
                <span className={own.placeCount}>
                  {" "}
                  {l.mentions} {l.mentions === 1 ? "mention" : "mentions"}
                  {l.facts ? `, ${l.facts} ${l.facts === 1 ? "fact" : "facts"}` : ""}
                </span>
              </span>
              {l.cfi ? (
                <Link className={own.libraryLink} href={`/books/${l.bookId}/read?at=${encodeURIComponent(l.cfi)}`}>
                  Open in {l.title}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>Nothing in your other books.</p>
      )}
      <p className={styles.groupLabel}>From the world</p>
      {layers?.world ? (
        <aside className={`${styles.machine} ${own.facts}`} aria-label="What the world knows" data-testid="xray-world">
          <p className={styles.machineLabel}>Written by {layers.fake ? "the test AI" : "AI"} from general knowledge, not from the book</p>
          <p>{layers.world.text}</p>
          <p className={styles.provenance}>
            {layers.world.provenance.model} · {when(layers.world.createdAt)} · $
            {layers.world.provenance.costUsd.toFixed(layers.world.provenance.costUsd < 0.01 ? 4 : 2)}
          </p>
        </aside>
      ) : layers && layers.estimate === null ? (
        <p className={styles.hint}>AI is not set up yet: the owner needs to add an Anthropic API key.</p>
      ) : layers ? (
        <div className={styles.noteActions}>
          <button type="button" className={styles.tool} disabled={asking} onClick={() => void askWorld()}>
            {asking ? "Asking…" : `What is generally known (${usd(layers.estimate ?? 0)})`}
          </button>
        </div>
      ) : null}
      {askError ? (
        <p className={styles.formError} role="alert">
          {askError}
        </p>
      ) : null}
      <p className={styles.groupLabel}>Where it appears</p>
      <ul className={own.places}>
        {entry.chapters
          .filter((c) => showAll || c.soFar > 0)
          .map((c) => (
            <li key={c.index}>
              <button type="button" className={own.place} onClick={() => onGo(c.cfi)}>
                <span>{label.get(c.index) ?? `Part ${c.index + 1}`}</span>
                <span className={own.placeCount}>{showAll ? c.count : c.soFar}</span>
              </button>
            </li>
          ))}
        {!showAll && ahead > 0 ? (
          <li>
            <span className={own.placeAhead}>{ahead === 1 ? "and a chapter ahead of you" : `and ${ahead} chapters ahead of you`}</span>
          </li>
        ) : null}
      </ul>
      {entry.facts.length ? null : <p className={styles.hint}>From the book’s own text. Read the book with Claude (in Who &amp; what) for what it says about each name.</p>}
    </>
  );
}
