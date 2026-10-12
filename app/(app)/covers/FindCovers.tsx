"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type Status = { found: number; none: number; looking: boolean; progress: { done: number; total: number; found: number } | null };

/** "Find covers now" (M22): starts a lookup for the reader's titles without a cover and shows how far it has got. */
export function FindCovers({ found, none }: { found: number; none: number }) {
  const router = useRouter();
  const [looking, setLooking] = useState(false);
  const [line, setLine] = useState("");
  // Asks how the lookup is going after `ms` (set by the effect below, which owns the timer).
  const check = useRef<(ms: number) => void>(() => {});
  // Whether this page saw a lookup running, so its end is announced and the lists reloaded once.
  const sawRun = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    async function poll() {
      const res = await fetch("/api/covers", { cache: "no-store" }).catch(() => null);
      const s = (res?.ok ? await res.json() : null) as Status | null;
      if (stopped) return;
      if (!s) {
        setLooking(false);
        setLine("Could not tell how the lookup is going. Reload the page in a minute.");
        return;
      }
      if (s.looking) {
        sawRun.current = true;
        setLooking(true);
        setLine(s.progress ? `Looking up covers: ${s.progress.done} of ${s.progress.total} titles, ${s.progress.found} found so far.` : "Looking up covers for the library…");
        check.current(1500);
        return;
      }
      setLooking(false);
      if (sawRun.current) {
        sawRun.current = false;
        setLine(`Done. ${s.found} ${s.found === 1 ? "title has" : "titles have"} a found cover; ${s.none} without one.`);
        router.refresh();
      }
    }
    check.current = (ms) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void poll(), ms);
    };
    // A lookup may already be running (the server's own, or one started before a reload).
    check.current(0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  async function start() {
    sawRun.current = true;
    setLooking(true);
    setLine("Looking up covers…");
    const res = await fetch("/api/covers", { method: "POST" }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      sawRun.current = false;
      setLooking(false);
      setLine(body.error ?? "The lookup could not start. Try again in a moment.");
      return;
    }
    check.current(800);
  }

  return (
    <div className={styles.find}>
      <p className={styles.summary}>
        <strong>{found}</strong> found · <strong>{none}</strong> without a cover
      </p>
      <button type="button" className={styles.findButton} onClick={start} disabled={looking} aria-describedby="find-status">
        {looking ? "Looking…" : "Find covers now"}
      </button>
      <p id="find-status" className={styles.status} aria-live="polite" data-testid="find-status">
        {line}
      </p>
    </div>
  );
}
