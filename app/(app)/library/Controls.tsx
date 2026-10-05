"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
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
  const [q, setQ] = useState(params.get("q") ?? "");
  const [, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update("q", q.trim()), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className={styles.controls} role="search">
      <label className={styles.searchLabel}>
        <span className="visually-hidden">Search your shelf</span>
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
