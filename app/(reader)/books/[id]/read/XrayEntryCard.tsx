"use client";

import { KIND_LABELS, type XrayChapter, type XrayFact, type XrayListEntry } from "@/lib/library/xray";
import styles from "./reader.module.css";
import own from "./XrayEntryCard.module.css";

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
  entry,
  chapters,
  position,
  showAll,
  fake,
  onGo,
}: {
  entry: XrayListEntry;
  chapters: XrayChapter[];
  position: number;
  showAll: boolean;
  /** The answers came from the test AI (browser tests), not Claude. */
  fake?: boolean;
  onGo: (cfi: string, fact?: XrayFact) => void;
}) {
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
