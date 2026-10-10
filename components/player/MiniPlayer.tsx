"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { VoiceRecorder, type RecorderState } from "@/components/notes/VoiceRecorder";
import { FilledIcon, Icon } from "@/components/shell/icons";
import { SPEEDS, speedLabel } from "@/lib/player/session";
import styles from "./MiniPlayer.module.css";

/** What the mini-player shows and can do (components/player/ListenSession.tsx works it out). */
export type MiniView = {
  /** The book's title. */
  title: string;
  /** What went wrong, or that the audiobook is loading ("" when all is well). */
  status: string;
  /** The sentence being read, and the word being said in it ([from, to), offsets into `sentence`; null: none yet). */
  sentence: string;
  lit: [number, number] | null;
  /** Its chapter ("Ch. V"), the time left ("18 min left"), and the speed when it is not 1 (" at 1.25×"): any may be "". */
  chapter: string;
  left: string;
  atSpeed: string;
  playing: boolean;
  busy: boolean;
  disabled: boolean;
  /** A made voice stopped to ask before paying for the next paragraph (the status line says what it costs). */
  asking?: boolean;
  speed: number;
  /** Play or Pause; called inside the click (Safari starts audio only from a tap or click). */
  toggle: () => void;
  back: () => void;
  forward: () => void;
  setSpeed: (speed: number) => void;
  /** The reader, at the paragraph being read. */
  pageHref: string;
  /** Think aloud (M14 step 6c): pauses the reading, and says whether it was playing and where the voice note goes. */
  thinkAloud: () => Thought;
  /** Saves the voice note there (the paragraph, quoting its sentence). */
  saveThought: (recording: Blob, durationMs: number, place: Thought) => Promise<void>;
};

/** Where a voice note made while listening goes: the paragraph being read and the sentence shown. */
export type Thought = { wasPlaying: boolean; cfi: string; quote: string };

/** The sentence from a little before the word: at most `keep` characters before it, from a word's start, once it is longer than `over`. */
function fromNear(before: string, at: number, over: number, keep: number) {
  if (at <= over) return before;
  const cut = before.lastIndexOf(" ", at - keep);
  return cut > 0 ? `…${before.slice(cut + 1)}` : before;
}

/**
 * The mini-player (M14 step 6b; the design's "PicksPlayer", B with speed):
 * away from the reader, at the foot of every page of the app while a book is
 * read aloud. On a phone it sits above the tabs. The sentence shows from a
 * little before the word being said (more of it on a wide screen), at most
 * three lines, so the bar never grows tall and the word is always in sight.
 */
export function MiniPlayer({ view }: { view: MiniView }) {
  const { sentence, lit } = view;
  // The room the bar takes at the foot of the screen (its height and its place above the foot, the tabs on a
  // phone), kept up to date as the sentence changes: keyboard focus is scrolled clear of it (app/globals.css).
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty("--miniplayer-room", `${Math.ceil(el.offsetHeight + (parseFloat(getComputedStyle(el).bottom) || 0) + 8)}px`);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    window.addEventListener("resize", measure);
    // Safari does not use that room when focus moves: something in the page focused behind the bar is lifted above it.
    const lift = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.closest("#content")) return;
      const r = t.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (r.bottom > b.top && r.right > b.left && r.left < b.right) window.scrollBy({ top: r.bottom - b.top + 8, behavior: "instant" });
    };
    document.addEventListener("focusin", lift);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", lift);
      root.style.removeProperty("--miniplayer-room");
    };
  }, []);
  const before = lit ? sentence.slice(0, lit[0]) : sentence;
  const word = lit ? sentence.slice(lit[0], lit[1]) : "";
  const after = lit ? sentence.slice(lit[1]) : "";
  const at = lit ? lit[0] : 0;
  const speed = <SpeedMenu speed={view.speed} onChange={view.setSpeed} />;
  // Think aloud: where the voice note goes (set when the panel opens, with the reading paused), whether it is
  // saved, and the recorder's state.
  const [thought, setThought] = useState<Thought | null>(null);
  const [saved, setSaved] = useState(false);
  const [recorder, setRecorder] = useState<RecorderState>("idle");
  // Going to the page was tried while a recording would be lost.
  const [warned, setWarned] = useState(false);
  const thinkButton = useRef<HTMLButtonElement>(null);
  const afterSave = useRef<HTMLButtonElement>(null);
  // Closing the panel now would lose a recording (being made, made, or being saved): only Back or Discard may.
  const losing = !!thought && !saved && recorder !== "idle";
  const closeThought = (focus: boolean) => {
    setThought(null);
    setWarned(false);
    setRecorder("idle");
    if (focus) thinkButton.current?.focus();
  };
  // Saved: the next step (Resume, or Close) has the keyboard.
  useEffect(() => {
    if (saved) afterSave.current?.focus();
  }, [saved]);
  // Escape closes the panel, unless that would lose a recording. Focus goes back to the button only from the bar
  // (or from nowhere, Safari's case after a click): a keyboard user on the page stays where they are.
  useEffect(() => {
    if (!thought || losing) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const from = document.activeElement;
      setThought(null);
      setWarned(false);
      setRecorder("idle");
      if (!from || from === document.body || bar.current?.contains(from)) thinkButton.current?.focus();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [thought, losing]);

  return (
    <section ref={bar} className={styles.bar} aria-label="Now playing" data-miniplayer="">
      <p className={styles.sentence}>
        <span className={styles.wide}>{fromNear(before, at, 160, 120)}</span>
        <span className={styles.narrow}>{fromNear(before, at, 60, 40)}</span>
        {word ? <mark className={styles.lit}>{word}</mark> : null}
        {after}
      </p>
      {/* Always in the page, so a screen reader reads out a message that comes later; empty, it takes no room. */}
      <p className={styles.status} role="status">
        {view.status}
      </p>
      <div className={styles.row}>
        {/* A small cloth swatch, as in the design (the book's own cover is not kept by the player). */}
        <span className={styles.cover} aria-hidden="true" />
        <span className={styles.book}>
          <span className={styles.title}>{view.title}</span>
          {view.chapter || view.left ? (
            <span className={styles.where}>
              {view.chapter ? <span className={styles.chapter}>{view.chapter}</span> : null}
              {view.chapter && view.left ? <span className={styles.dot}> · </span> : null}
              {view.left ? (
                <span className={styles.left}>
                  {view.left}
                  {view.atSpeed ? <span className={styles.atSpeed}>{view.atSpeed}</span> : null}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        {/* The speed comes first on a phone and after Forward on a wide screen: one of the two shows, so the
            keyboard and screen-reader order always matches what is seen. */}
        <span className={styles.speedPhone}>{speed}</span>
        <button type="button" className={styles.skip} aria-label="Back 15 seconds" onClick={view.back} disabled={view.disabled}>
          <Icon name="back15" className={styles.icon} />
        </button>
        <button type="button" className={styles.play} aria-label={view.busy ? "Preparing" : view.playing ? "Pause" : view.asking ? "Keep reading" : "Play"} onClick={view.toggle} disabled={view.disabled}>
          <FilledIcon name={view.playing ? "pause" : "play"} className={styles.playIcon} />
        </button>
        <button type="button" className={styles.skip} aria-label="Forward 15 seconds" onClick={view.forward} disabled={view.disabled}>
          <Icon name="forward15" className={styles.icon} />
        </button>
        <span className={styles.gap} />
        <span className={styles.speedWide}>{speed}</span>
        <Link
          href={view.pageHref}
          className={styles.goTo}
          aria-disabled={losing || undefined}
          onClick={(e) => {
            // Leaving for the reader would throw an unsaved recording away.
            if (!losing) return;
            e.preventDefault();
            setWarned(true);
          }}
        >
          <Icon name="book" className={styles.goToIcon} />
          <span className={styles.goToText}>Go to the page</span>
        </Link>
        <button
          ref={thinkButton}
          type="button"
          className={styles.think}
          aria-expanded={!!thought}
          // Not while the next paragraph is being prepared: it would start reading by itself during the recording.
          disabled={!thought && view.busy}
          onClick={() => {
            // A second press closes the panel, unless that would lose a recording.
            if (thought) {
              if (!losing) closeThought(false);
              return;
            }
            setSaved(false);
            setThought(view.thinkAloud());
          }}
        >
          <Icon name="mic" className={styles.goToIcon} />
          <span className={styles.thinkText}>Think aloud</span>
        </button>
      </div>
      {thought ? (
        <section className={styles.thinkPanel} aria-label="Think aloud">
          <p className={styles.thinkLabel} role="status">
            {saved ? "Saved to your notes, at this sentence:" : "A voice note at this sentence:"}
          </p>
          <blockquote className={styles.thinkQuote}>{thought.quote}</blockquote>
          {warned && losing ? (
            <p className={styles.thinkWarn} role="alert">
              Save or discard this voice note first: going to the page now would lose it.
            </p>
          ) : null}
          {saved ? (
            <div className={styles.thinkActions}>
              <button ref={thought.wasPlaying ? undefined : afterSave} type="button" className={styles.thinkClose} onClick={() => closeThought(true)}>
                Close
              </button>
              {thought.wasPlaying ? (
                <button
                  ref={afterSave}
                  type="button"
                  className={styles.thinkResume}
                  onClick={() => {
                    closeThought(true);
                    // Plays only if paused (inside the click, as Safari needs).
                    if (!view.playing) view.toggle();
                  }}
                >
                  Resume reading aloud
                </button>
              ) : null}
            </div>
          ) : (
            <VoiceRecorder
              onStateChange={setRecorder}
              onSave={async (recording, durationMs) => {
                await view.saveThought(recording, durationMs, thought);
                setSaved(true);
              }}
              onBack={() => closeThought(true)}
            />
          )}
        </section>
      ) : null}
    </section>
  );
}

/**
 * The speed: a pill that opens a menu of speeds above it. It closes on a
 * choice, on Escape, on a click elsewhere, when keyboard focus moves to
 * something outside it, and on a new page.
 */
function SpeedMenu({ speed, onChange }: { speed: number; onChange: (speed: number) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  // A new page closes it (the mini-player itself stays from page to page).
  const pathname = usePathname();
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    // Escape from anywhere on the page: Safari does not focus a button that is clicked, so after a
    // click on the pill the key goes to the page, not to the menu.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      pill.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const words = speedLabel(speed).replace("×", " times");
  return (
    <div
      className={styles.speedBox}
      ref={box}
      onBlur={(e) => {
        // Only focus moved to something else (Tab). A click in Safari leaves focus nowhere (no relatedTarget):
        // closing then would drop the choice being clicked; a click elsewhere is handled above.
        if (open && e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
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
