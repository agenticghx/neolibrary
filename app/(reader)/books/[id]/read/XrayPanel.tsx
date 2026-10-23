"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KIND_LABELS, type XrayList, type XrayListEntry } from "@/lib/library/xray";
import type { XraySummary } from "@/lib/library/xray-read";
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
 * X3: "Build the X-ray" reads the whole book with Claude, chapter by chapter,
 * behind an estimate and a confirm box; the list then carries kinds and each
 * name's facts, with their quotes. Marks on the page are X2.
 */
type Build = Partial<XraySummary> & { configured: boolean; fake?: boolean };
const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);
export function XrayPanel({ bookId, cfi, onTab, onGo }: { bookId: string; cfi: string; onTab: (tab: StudyTab) => void; onGo: (cfi: string) => void }) {
  const [data, setData] = useState<(XrayList & { fake?: boolean }) | null>(null);
  const [tick, setTick] = useState(0);
  const [build, setBuild] = useState<Build | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
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
  }, [bookId, cfi, tick]);

  // Reading the book with Claude (X3): what is read, what the rest costs; polled while a run goes on, and the
  // list fetched again when it ends (kinds and facts have arrived).
  const loadBuild = useCallback(
    () =>
      fetch(`/api/books/${bookId}/xray/build`)
        .then(async (res) => (res.ok ? ((await res.json()) as Build) : null))
        .then((b) => b && setBuild(b))
        .catch(() => undefined),
    [bookId],
  );
  useEffect(() => {
    void loadBuild();
  }, [loadBuild]);
  const running = !!build?.running;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) setTick((t) => t + 1);
    wasRunning.current = running;
    if (!running) return;
    const t = setInterval(() => void loadBuild(), 1500);
    return () => clearInterval(t);
  }, [running, loadBuild]);

  const startBuild = async () => {
    setBusy(true);
    setBuildError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/xray/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: agree }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That did not start. Try again.");
      setBuild({ configured: true, fake: build?.fake, ...body });
      // A run that ended at once (a book read before, or the test AI) is over before this answer is read: ask again.
      if (!body.running) {
        void loadBuild();
        setTick((t) => t + 1);
      }
    } catch (e) {
      setBuildError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const stopBuild = async () => {
    await fetch(`/api/books/${bookId}/xray/build`, { method: "DELETE" }).catch(() => undefined);
    void loadBuild();
  };

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
          <XrayEntryCard bookId={bookId} entry={current} chapters={data.chapters} position={data.position} showAll={showAll} fake={data.fake} onGo={onGo} />
        </article>
      ) : null}
      {data && !current && build ? (
        <section className={own.build} aria-label="Read the book with Claude">
          {!build.configured ? (
            <p className={styles.hint}>
              Names from the book’s text. For what it says about each, AI needs setting up: the owner adds an Anthropic API key on the server, or reads
              the book on the laptop with the subscription (the xray-on-subscription skill).
            </p>
          ) : (
            <>
              <p className={own.buildLine} data-testid="xray-build-line">
                {build.done} of {build.chapters} chapters read{build.facts ? ` · ${build.facts} ${build.facts === 1 ? "fact" : "facts"}` : ""}
              </p>
              {build.running ? (
                <>
                  <progress className={own.progress} value={build.done} max={build.chapters} aria-label="Chapters read" />
                  <p className={styles.hint}>Reading {build.current ?? "the book"}…</p>
                  <button type="button" className={styles.tool} onClick={() => void stopBuild()} disabled={build.stopping}>
                    {build.stopping ? "Stopping…" : "Stop"}
                  </button>
                </>
              ) : null}
              {!build.running && build.stoppedBecause ? (
                <p className={styles.hint} role="status">
                  {build.stoppedBecause.message}
                </p>
              ) : null}
              {!build.running && (build.done ?? 0) < (build.chapters ?? 0) ? (
                <>
                  <label className={own.toggle}>
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I understand this reads {(build.chapters ?? 0) - (build.done ?? 0)} chapters with{" "}
                    {build.fake ? "the test AI" : "Claude"} and costs {usd(build.estimateUsd ?? 0)} at most
                  </label>
                  {build.overLimit && build.caps ? (
                    <p className={styles.hint}>
                      That passes a spending cap: {usd(build.caps.spentBookUsd)} of {usd(build.caps.perBookUsd)} spent on this book, {usd(build.caps.spentMonthUsd)} of{" "}
                      {usd(build.caps.perMonthUsd)} this month.
                    </p>
                  ) : null}
                  <button type="button" className={styles.primaryTool} disabled={!agree || busy || build.overLimit} onClick={() => void startBuild()}>
                    {busy ? "Starting…" : build.done ? "Read the rest" : "Build the X-ray"}
                  </button>
                </>
              ) : null}
              {buildError ? (
                <p className={styles.formError} role="alert">
                  {buildError}
                </p>
              ) : null}
            </>
          )}
        </section>
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
            {entries.length} of {data.entries.length} names{showAll ? "" : ", met so far"}. Counts are mentions {showAll ? "in the whole book" : "up to where you are"}.
          </p>
        </>
      ) : null}
    </section>
  );
}
