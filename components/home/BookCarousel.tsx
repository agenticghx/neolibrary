"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cover } from "@/components/Cover";
import { Icon } from "@/components/shell/icons";
import { availabilityLabel } from "@/lib/library/availability";
import type { LibraryItem } from "@/lib/library/home";
import styles from "./BookCarousel.module.css";

/** How far a cover may tilt (degrees) and shrink at the strip's edges: the inside of a curved wall. */
const TILT = 14;
const SHRINK = 0.1;

/**
 * Books in a strip, as on Hark (M24, Samuel 2026-10-14). Measured from his recording: the strip sits still
 * until it is swiped, dragged or stepped with the arrows, glides, then settles with a book in the middle.
 * Nothing moves on its own. The middle book shows its title and what you can do with it in a pill; the
 * others tilt away a little. Every cover is an ordinary link, in order, so Tab walks the strip.
 */
export function BookCarousel({ items, label, testId = "carousel", demo = false }: { items: LibraryItem[]; label: string; testId?: string; /** The design page's sample books link nowhere. */ demo?: boolean }) {
  const strip = useRef<HTMLUListElement>(null);
  const [current, setCurrent] = useState(0);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  // Each cover's distance from the middle, -1 (a card's width or more to the left) to 1, drawn as tilt and size.
  const measure = useCallback(() => {
    const ul = strip.current;
    if (!ul) return;
    const middle = ul.scrollLeft + ul.clientWidth / 2;
    let nearest = 0;
    let best = Infinity;
    [...ul.children].forEach((child, i) => {
      const li = child as HTMLElement;
      const centre = li.offsetLeft + li.offsetWidth / 2;
      const d = Math.max(-1, Math.min(1, (centre - middle) / (li.offsetWidth * 1.5)));
      li.style.setProperty("--tilt", `${(-d * TILT).toFixed(2)}deg`);
      li.style.setProperty("--shrink", (1 - Math.abs(d) * SHRINK).toFixed(3));
      if (Math.abs(centre - middle) < best) {
        best = Math.abs(centre - middle);
        nearest = i;
      }
    });
    setCurrent(nearest);
  }, []);

  useEffect(() => {
    const ul = strip.current;
    if (!ul) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    ul.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      ul.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [measure, items.length]);

  const go = (index: number) => {
    const ul = strip.current;
    const li = ul?.children[Math.max(0, Math.min(items.length - 1, index))] as HTMLElement | undefined;
    if (!ul || !li) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ul.scrollTo({ left: li.offsetLeft + li.offsetWidth / 2 - ul.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
  };

  // A mouse drags the strip like a finger does (a trackpad and a touch screen scroll it themselves).
  const onPointerDown = (e: React.PointerEvent<HTMLUListElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLUListElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 6) return;
    if (!d.moved) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.dataset.dragging = "";
    }
    e.currentTarget.scrollLeft = d.left - dx;
  };
  const endDrag = (e: React.PointerEvent<HTMLUListElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.moved) {
      delete e.currentTarget.dataset.dragging;
      go(current);
    }
    // Keep the flag for the click that follows the release, so a drag never opens a book.
    setTimeout(() => {
      drag.current = null;
    }, 0);
  };

  return (
    <section className={styles.carousel} aria-roledescription="carousel" aria-label={label} data-testid={testId}>
      <button type="button" className={[styles.arrow, styles.prev].join(" ")} aria-label="Previous book" disabled={current === 0} onClick={() => go(current - 1)}>
        <Icon name="chevron" className={styles.arrowIcon} />
      </button>
      <ul
        ref={strip}
        className={styles.strip}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(e) => {
          if (drag.current?.moved) e.preventDefault();
        }}
      >
        {items.map((b, i) => (
          <li key={b.id} className={styles.card} data-current={i === current ? "" : undefined} aria-current={i === current ? "true" : undefined}>
            <Link
              href={demo ? "#carousel" : `/books/${b.id}`}
              className={styles.link}
              draggable={false}
              onFocus={() => {
                if (i !== current) go(i);
              }}
            >
              <Cover title={b.title} available={b.available} caption={false} decorative size="fill" imageUrl={b.coverUrl} marks={{ notes: b.notes, audiobook: b.audiobook, finished: b.progress >= 1 }} />
              <span className={styles.pill}>
                <span className={styles.title}>{b.title}</span>
                <span className={styles.available}>{availabilityLabel(b.available)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" className={[styles.arrow, styles.next].join(" ")} aria-label="Next book" disabled={current >= items.length - 1} onClick={() => go(current + 1)}>
        <Icon name="chevron" className={styles.arrowIcon} />
      </button>
    </section>
  );
}
