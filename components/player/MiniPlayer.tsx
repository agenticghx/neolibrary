"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FilledIcon, Icon } from "@/components/shell/icons";
import { SPEEDS, speedLabel } from "@/lib/player/session";
import styles from "./MiniPlayer.module.css";

/** What the mini-player shows and can do (components/player/ListenSession.tsx works it out). */
export type MiniView = {
  /** The book's title. */
  title: string;
  /** The sentence being read, and the word being said in it ([from, to), offsets into `sentence`; null: none yet). */
  sentence: string;
  lit: [number, number] | null;
  /** Its chapter and the time left: "Ch. V · 18 min left at 1.25×". */
  where: string;
  playing: boolean;
  busy: boolean;
  disabled: boolean;
  speed: number;
  /** Play or Pause; called inside the click (Safari starts audio only from a tap or click). */
  toggle: () => void;
  back: () => void;
  forward: () => void;
  setSpeed: (speed: number) => void;
  /** The reader, at the paragraph being read. */
  pageHref: string;
};

/**
 * The mini-player (M14 step 6b; the design's "PicksPlayer", B with speed):
 * away from the reader, at the foot of every page of the app while a book is
 * read aloud. On a phone it sits above the tabs and shows the sentence from a
 * little before the word being said.
 */
export function MiniPlayer({ view }: { view: MiniView }) {
  const { sentence, lit } = view;
  const before = lit ? sentence.slice(0, lit[0]) : sentence;
  const word = lit ? sentence.slice(lit[0], lit[1]) : "";
  const after = lit ? sentence.slice(lit[1]) : "";
  // On a phone, a long sentence starts a few words before the word being said, so the word is always in sight.
  const cut = lit && lit[0] > 60 ? before.lastIndexOf(" ", lit[0] - 40) : -1;
  const shortBefore = cut > 0 ? `…${before.slice(cut + 1)}` : before;

  return (
    <section className={styles.bar} aria-label="Now playing" data-miniplayer="">
      <p className={styles.sentence}>
        <span className={styles.wide}>{before}</span>
        <span className={styles.narrow}>{shortBefore}</span>
        {word ? <mark className={styles.lit}>{word}</mark> : null}
        {after}
      </p>
      <div className={styles.row}>
        {/* A small cloth swatch, as in the design (the book's own cover is not kept by the player). */}
        <span className={styles.cover} aria-hidden="true" />
        <span className={styles.book}>
          <span className={styles.title}>{view.title}</span>
          {view.where ? <span className={styles.where}>{view.where}</span> : null}
        </span>
        <button type="button" className={styles.skip} aria-label="Back 15 seconds" onClick={view.back} disabled={view.disabled}>
          <Icon name="back15" className={styles.icon} />
        </button>
        <button type="button" className={styles.play} aria-label={view.busy ? "Preparing" : view.playing ? "Pause" : "Play"} onClick={view.toggle} disabled={view.disabled}>
          <FilledIcon name={view.playing ? "pause" : "play"} className={styles.playIcon} />
        </button>
        <button type="button" className={styles.skip} aria-label="Forward 15 seconds" onClick={view.forward} disabled={view.disabled}>
          <Icon name="forward15" className={styles.icon} />
        </button>
        <span className={styles.gap} />
        <SpeedMenu speed={view.speed} onChange={view.setSpeed} />
        <Link href={view.pageHref} className={styles.goTo}>
          <Icon name="book" className={styles.goToIcon} />
          <span className={styles.goToText}>Go to the page</span>
        </Link>
      </div>
    </section>
  );
}

/** The speed: a pill that opens a menu of speeds above it; Escape or a click elsewhere closes it. */
function SpeedMenu({ speed, onChange }: { speed: number; onChange: (speed: number) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      pill.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const words = speedLabel(speed).replace("×", " times");
  return (
    <div className={styles.speedBox} ref={box}>
      <button ref={pill} type="button" className={styles.speed} aria-label={`Playback speed: ${words}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {speedLabel(speed)}
      </button>
      {open ? (
        <div role="group" aria-label="Choose a speed" className={styles.menu}>
          <span className={styles.menuTitle}>Speed</span>
          <div className={styles.speeds}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={styles.speedChoice}
                aria-pressed={s === speed}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                  pill.current?.focus();
                }}
              >
                {speedLabel(s)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
