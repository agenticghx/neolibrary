"use client";

import { useActionState, useEffect, useRef } from "react";
import { moveOrRemoveTitleAction, type PathFormState } from "@/app/(app)/actions";
import { Outcome } from "@/components/paths/Outcome";
import { focusAfter, orderOf, type TitleOp } from "./focus";
import styles from "./page.module.css";

export type TitleRow = { id: string; kind: string; title: string; author: string; availability: string };

const start: PathFormState = { error: null, done: null };
const OPS: { op: TitleOp; label: string }[] = [
  { op: "up", label: "Move up" },
  { op: "down", label: "Move down" },
  { op: "remove", label: "Remove" },
];

/**
 * A section's titles in order, with Move up, Move down and Remove (M14 step
 * 5). After each, one line says what happened, and focus stays with the
 * title (after Remove: the title now in its place, else the section heading),
 * so a keyboard or screen-reader user keeps their place.
 */
export function TitleList({ slug, headingId, titles }: { slug: string; headingId: string; titles: TitleRow[] }) {
  const [state, act, pending] = useActionState(moveOrRemoveTitleAction, start);
  const box = useRef<HTMLDivElement>(null);
  const asked = useRef<{ op: TitleOp; slotId: string; index: number; order: string } | null>(null);

  useEffect(() => {
    const a = asked.current;
    if (!a || pending) return;
    if (orderOf(titles) === a.order) return; // the refreshed list is not on screen yet
    asked.current = null;
    const heading = document.getElementById(headingId);
    const at = document.activeElement;
    // Leave focus alone if the reader has gone elsewhere (Safari never focuses a clicked button, so the body is normal here).
    if (at && at !== document.body && at !== heading && !box.current?.contains(at)) return;
    const want = focusAfter(titles, a);
    ((want && box.current?.querySelector<HTMLElement>(`[data-focus="${want}"]`)) || heading)?.focus();
  }, [titles, pending, headingId]);

  return (
    <div ref={box} className={styles.titleList}>
      {titles.length ? (
        <ol className={styles.titles}>
          {titles.map((t, i) => (
            <li key={t.id} className={styles.title}>
              <span className={styles.titleText}>
                <span className={styles.kind}>{t.kind}</span>
                <span className={styles.name}>{t.title}</span>
                {t.author ? <span className={styles.author}>{t.author}</span> : null}
                <span className={styles.available}>{t.availability}</span>
              </span>
              <span className={styles.actions}>
                {OPS.map(({ op, label }) => (
                  <form
                    key={op}
                    action={act}
                    onSubmit={(e) => {
                      // One change at a time: a second click while the first is on its way does nothing.
                      if (pending) e.preventDefault();
                      else asked.current = { op, slotId: t.id, index: i, order: orderOf(titles) };
                    }}
                  >
                    <input type="hidden" name="slotId" value={t.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="op" value={op} />
                    <button
                      type="submit"
                      className={styles.button}
                      data-focus={`${t.id}:${op}`}
                      disabled={(op === "up" && i === 0) || (op === "down" && i === titles.length - 1)}
                    >
                      {label}
                      <span className="visually-hidden">{` ${t.title}`}</span>
                    </button>
                  </form>
                ))}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>No titles yet.</p>
      )}
      <Outcome state={state} pending={pending} testId="titles-status" />
    </div>
  );
}
