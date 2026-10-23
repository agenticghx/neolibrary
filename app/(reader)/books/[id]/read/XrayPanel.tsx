"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_LABELS, type XrayList, type XrayListEntry } from "@/lib/library/xray";
import { StudyTabs, type StudyTab } from "./StudyTabs";
import { Trail, XrayEntryCard } from "./XrayEntryCard";
import styles from "./reader.module.css";
import own from "./XrayPanel.module.css";

/**
 * Who & what (M32 X1): the people, places and terms the book names, most
 * mentioned so far first, each with its trail of chapters. The list knows
 * where the reader is: an entry not yet met is not listed, and a trail shows
 * the chapters ahead as empty, until "Show everything" is ticked. Tapping an
 * entry shows where it appears; each chapter opens its first mention.
 *
 * X1 knows names only (found in the text, no AI): kinds and facts come with
 * Claude's reading (X3); marks on the page come in X2.
 */
export function XrayPanel({ bookId, cfi, onTab, onGo }: { bookId: string; cfi: string; onTab: (tab: StudyTab) => void; onGo: (cfi: string) => void }) {
  const [data, setData] = useState<XrayList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follows the reader through the book: a page turn refetches after a short pause, as the saved position does.
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/books/${bookId}/xray?${new URLSearchParams({ cfi })}`)
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!live) return;
          if (!res.ok) setError(body.error ?? "The index could not be loaded.");
          else setData(body);
        })
        .catch(() => live && setError("The index could not be loaded."));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, data ? 600 : 0);
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `data` only decides the first load's delay
  }, [bookId, cfi]);

  const chapterLabel = useMemo(() => new Map((data?.chapters ?? []).map((c) => [c.index, c.label])), [data]);

  const entries = useMemo(() => {
    let list = data?.entries ?? [];
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q)));
    if (!showAll) list = list.filter((e) => e.seen);
    return showAll ? [...list].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)) : list;
  }, [data, query, showAll]);

  const current = open ? data?.entries.find((e) => e.id === open) : undefined;
  const count = (e: XrayListEntry) => (showAll ? e.total : e.soFar);

  const trail = (e: XrayListEntry) => <Trail entry={e} chapters={data?.chapters ?? []} position={data?.position ?? 0} showAll={showAll} />;

  return (
    <section className={styles.panel} aria-label="Who & what">
      <p className={styles.panelTitle}>Who &amp; what</p>
      <StudyTabs current="xray" onPick={onTab} />
      {!data && !error ? <p className={styles.hint}>Reading the book’s names…</p> : null}
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      {data && current ? (
        <article className={own.card} aria-label={current.name} data-testid="xray-card">
          <button type="button" className={own.back} onClick={() => setOpen(null)}>
            Back to the list
          </button>
          <XrayEntryCard entry={current} chapters={data.chapters} position={data.position} showAll={showAll} onGo={onGo} />
        </article>
      ) : null}
      {data && !current ? (
        <>
          <input
            className={own.search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a name"
            aria-label="Find a name"
          />
          <label className={own.toggle}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show everything, including what is ahead
          </label>
          {entries.length ? (
            <ul className={own.list} data-testid="xray-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <button type="button" className={own.row} onClick={() => setOpen(e.id)}>
                    <span className={own.name}>{e.name}</span>
                    <span className={own.count}>{count(e)}</span>
                    <span className={own.kind}>
                      {e.kind !== "name" ? `${KIND_LABELS[e.kind]} · ` : ""}
                      met in {chapterLabel.get(e.firstChapter) ?? "the book"}
                    </span>
                    {trail(e)}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint}>{query ? "No name like that." : "No one named yet. Read on."}</p>
          )}
          <p className={styles.hint}>
            {entries.length} of {data.entries.length} names{showAll ? "" : ", met so far"}. Counts are mentions {showAll ? "in the whole book" : "up to where you are"}; from the
            book’s own text.
          </p>
        </>
      ) : null}
    </section>
  );
}
