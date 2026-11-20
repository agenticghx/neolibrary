"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import styles from "./page.module.css";

const SORTS = [
  ["recent", "Recently added"],
  ["title", "Title"],
  ["author", "Author"],
  ["progress", "Progress"],
] as const;

/** Search and sort; both live in the address bar so a view can be bookmarked. */
export function Controls() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ);
  const [q, setQ] = useState(urlQ);
  if (urlQ !== seenUrlQ) {
    setSeenUrlQ(urlQ);
    setQ(urlQ);
  }
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);
  const [, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(paramsRef.current.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed === (paramsRef.current.get("q") ?? "")) return;
    const t = setTimeout(() => update("q", trimmed), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className={styles.controls} role="search" aria-label="Search titles">
      <label className={styles.searchLabel}>
        <span className="visually-hidden">Filter by title or author</span>
        <input
          type="search"
          className={styles.search}
          placeholder="Search by title or author"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <label className={styles.sortLabel}>
        Sort
        <select
          className={styles.sort}
          value={params.get("sort") ?? "recent"}
          onChange={(e) => update("sort", e.target.value === "recent" ? "" : e.target.value)}
        >
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
