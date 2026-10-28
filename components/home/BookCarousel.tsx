"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Cover } from "@/components/Cover";
import { Icon } from "@/components/shell/icons";
import { availabilityLabel } from "@/lib/library/availability";
import type { LibraryItem } from "@/lib/library/home";
import styles from "./BookCarousel.module.css";
import { marksText, progressLabel } from "./Library";

/** How far a cover may tilt (degrees) and shrink at the strip's edges: the inside of a curved wall. */
const TILT = 14;
const SHRINK = 0.1;
/** How fast the strip drifts on its own, in pixels a second: a book passes in about ten seconds. */
const DRIFT = 18;
/** How long the strip waits after a touch, an arrow or a drag before it drifts again (ms). */
const RESUME = 2500;

/**
 * Whether the strip may drift. Never for a reader who asked for less motion. Never under a test robot either
 * (navigator.webdriver): a moving cover is never "still" enough for Playwright to click, and the reference
 * screenshots of Home, Library and the design page would differ every run. A test that checks the drift itself
 * sets window.neolibraryDrift first (e2e/shell.spec.ts).
 */
function mayDrift() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return !navigator.webdriver || (window as { neolibraryDrift?: boolean }).neolibraryDrift === true;
}

/**
 * Books in a strip, as on Hark (M24, Samuel 2026-10-14). The strip drifts slowly on its own (Samuel 2026-10-27,
 * replacing "nothing moves on its own"), and turns back at each end. A mouse over the strip, a finger on it, or
 * the keyboard in it stops the drift where it is; the book under the mouse straightens and comes forward a little
 * (BookCarousel.module.css). It can still be swiped, dragged or stepped with the arrows. The middle book shows its
 * title and what you can do with it in a pill; the others tilt away a little. Every cover is an ordinary link,
 * in order, so Tab walks the strip.
 */
export function BookCarousel({ items, label, testId = "carousel", demo = false }: { items: LibraryItem[]; label: string; testId?: string; /** The design page's sample books link nowhere. */ demo?: boolean }) {
  const strip = useRef<HTMLUListElement>(null);
  const [current, setCurrent] = useState(0);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  // The strip opens on its middle book, with books on both sides (Samuel 2026-10-15: the first book in the middle
  // left the left half empty and the strip looked right-aligned). Done once, as soon as the strip has a width:
  // a strip in a hidden view has none until the View switch shows it.
  const centred = useRef(false);
  // Why the drift is stopped: the mouse is over the strip, a finger or the keyboard is on it, or it is off screen.
  // "Until" is a time (ms): after a touch, an arrow or a drag the strip waits before it drifts again.
  const still = useRef({ hover: false, touch: false, focus: false, hidden: false, until: 0 });
  const [drifting, setDrifting] = useState(false);

  // Each cover's distance from the middle, -1 (a card's width or more to the left) to 1, drawn as tilt and size.
  const measure = useCallback(() => {
    const ul = strip.current;
    if (!ul) return;
    if (!centred.current && ul.clientWidth > 0) {
      centred.current = true;
      const mid = ul.children[Math.floor((ul.children.length - 1) / 2)] as HTMLElement | undefined;
      if (mid) ul.scrollLeft = mid.offsetLeft + mid.offsetWidth / 2 - ul.clientWidth / 2;
    }
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

  // Before the first paint, so the strip never shows itself on its first book and then jumps.
  useLayoutEffect(() => {
    const ul = strip.current;
    if (!ul) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    ul.addEventListener("scroll", onScroll, { passive: true });
    // A new width (the window, or the strip shown again by the View switch) moves the middle.
    const resized = new ResizeObserver(onScroll);
    resized.observe(ul);
    return () => {
      cancelAnimationFrame(frame);
      ul.removeEventListener("scroll", onScroll);
      resized.disconnect();
    };
  }, [measure, items.length]);

  // The drift: each frame moves the strip by the time since the last one, so its speed is the same on any screen.
  // The strip keeps its own exact place (pos), because a browser may round scrollLeft to whole pixels and a slow
  // drift moves less than one a frame; a place more than a pixel off means a person moved the strip.
  useEffect(() => {
    const ul = strip.current;
    if (!ul) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = 0;
    let pos = ul.scrollLeft;
    let dir = 1;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const s = still.current;
      const max = ul.scrollWidth - ul.clientWidth;
      if (s.hover || s.touch || s.focus || s.hidden || now < s.until || ul.clientWidth === 0 || max <= 0) {
        last = 0;
        return;
      }
      if (Math.abs(ul.scrollLeft - pos) > 1.5) pos = ul.scrollLeft;
      const dt = last ? Math.min(now - last, 100) / 1000 : 0;
      last = now;
      pos += dir * DRIFT * dt;
      if (pos >= max) [pos, dir] = [max, -1];
      if (pos <= 0) [pos, dir] = [0, 1];
      ul.scrollLeft = pos;
    };
    const seen = new IntersectionObserver(([entry]) => {
      still.current.hidden = !entry.isIntersecting;
    });
    const start = () => {
      cancelAnimationFrame(frame);
      const on = mayDrift();
      setDrifting(on);
      if (on) frame = requestAnimationFrame(tick);
    };
    seen.observe(ul);
    start();
    motion.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      motion.removeEventListener("change", start);
    };
  }, []);

  const wait = () => {
    still.current.until = performance.now() + RESUME;
  };

  const go = (index: number) => {
    wait();
    const ul = strip.current;
    const li = ul?.children[Math.max(0, Math.min(items.length - 1, index))] as HTMLElement | undefined;
    if (!ul || !li) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ul.scrollTo({ left: li.offsetLeft + li.offsetWidth / 2 - ul.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
  };

  // A mouse drags the strip like a finger does (a trackpad and a touch screen scroll it themselves).
  const onPointerDown = (e: React.PointerEvent<HTMLUListElement>) => {
    if (e.pointerType === "touch") still.current.touch = true;
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
    if (e.pointerType === "touch") {
      still.current.touch = false;
      wait();
    }
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
    <section className={styles.carousel} aria-roledescription="carousel" aria-label={label}>
      <button type="button" className={[styles.arrow, styles.prev].join(" ")} aria-label="Previous book" disabled={current === 0} onClick={() => go(current - 1)}>
        <Icon name="chevron" className={styles.arrowIcon} />
      </button>
      <ul
        ref={strip}
        className={styles.strip}
        data-testid={testId}
        data-drifting={drifting ? "" : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType !== "touch") still.current.hover = true;
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "touch") still.current.hover = false;
        }}
        onFocus={() => {
          still.current.focus = true;
        }}
        onBlur={() => {
          still.current.focus = false;
          wait();
        }}
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
                <span className={styles.itemTitle}>{b.title}</span>
                {b.author ? <span className={styles.author}>{b.author}</span> : null}
                <span className={styles.meta}>
                  <span>{availabilityLabel(b.available)}</span>
                  {b.available.read || b.available.listen ? <span>{progressLabel(b.progress)}</span> : null}
                </span>
                {marksText(b) ? <span className="visually-hidden">{`, ${marksText(b)}`}</span> : null}
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
