"use client";

import { useEffect, useRef, useState } from "react";
import type { XrayList } from "@/lib/library/xray";
import { XrayEntryCard } from "./XrayEntryCard";
import styles from "./reader.module.css";
import own from "./XrayCard.module.css";

/**
 * The card that opens from a name on the page (M32 X2, Samuel's pick A): over
 * the page on a computer, a sheet at the foot of a phone. It knows where the
 * reader is, like the Who & what list: what the book has said about the name
 * up to here, and a "Show everything" switch.
 */
export function XrayCard({ bookId, cfi, entryId, onClose, onGo, onAll }: { bookId: string; cfi: string | null; entryId: string; onClose: () => void; onGo: (cfi: string) => void; onAll: () => void }) {
  const [data, setData] = useState<(XrayList & { fake?: boolean }) | null>(null);
  const [showAll, setShowAll] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/books/${bookId}/xray?${new URLSearchParams(cfi ? { cfi } : {})}`)
        .then(async (res) => (res.ok ? ((await res.json()) as XrayList & { fake?: boolean }) : null))
        .then((body) => live && body && setData(body))
        .catch(() => undefined);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, data ? 600 : 0);
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `data` only decides the first load's delay
  }, [bookId, cfi]);

  const entry = data?.entries.find((e) => e.id === entryId);
  return (
    <aside className={own.card} aria-label={entry?.name ?? "Who & what"} data-testid="xray-card">
      <div className={own.head}>
        <span className={styles.groupLabel}>Who &amp; what</span>
        <button type="button" className={own.close} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {!data ? <p className={styles.hint}>Looking it up…</p> : null}
      {data && !entry ? <p className={styles.hint}>That name is not in the index.</p> : null}
      {data && entry ? <XrayEntryCard bookId={bookId} entry={entry} chapters={data.chapters} position={data.position} showAll={showAll} fake={data.fake} onGo={onGo} /> : null}
      <div className={own.foot}>
        <label className={own.toggle}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show everything
        </label>
        <button type="button" className={own.all} onClick={onAll}>
          All names
        </button>
      </div>
    </aside>
  );
}
