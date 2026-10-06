"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import styles from "./Home.module.css";

const SORTS = [
  ["recent", "Recently added"],
  ["title", "Title"],
  ["author", "Author"],
  ["progress", "Progress"],
] as const;

/** Sort the library; the choice lives in the address bar (?sort=), as on /library. */
export function SortMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  return (
    <label className={styles.sortLabel}>
      Sort
      <select
        className={styles.sort}
        value={params.get("sort") ?? "recent"}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value === "recent") next.delete("sort");
          else next.set("sort", e.target.value);
          const s = next.toString();
          startTransition(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
        }}
      >
        {SORTS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
