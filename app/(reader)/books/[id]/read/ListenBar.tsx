"use client";

import { useEffect, useRef, useState } from "react";
import type { Track, UploadedReading } from "@/lib/library/audio";
import { afterEnded, follow as followAudiobook } from "@/lib/readalong/player";
import { wordAt } from "@/lib/speech/timings";
import styles from "./reader.module.css";

type Passage = { id: string; cfi: string; nextId: string | null; characters: number };
type Info = {
  passage: Passage;
  voices: { id: string; name: string }[];
  track: (Track & { audioUrl: string }) | null;
  estimate: number | null;
  audiobook: UploadedReading | null;
};

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);

/**
 * Read aloud (M7): plays the paragraph at the reading position, then the
 * next, one paragraph of audio at a time (made on first play, stored after),
 * and highlights each word as it is spoken.
 *
 * With the book's own audiobook (M13 (d), "Your audiobook" among the voices):
 * one long file per chapter or book, played straight on from the reading
 * position. One audio element throughout: its source is set only when the
 * file changes (setting it again, even to the same address, reloads the audio
 * and starts it from 0), and where the audio is in the book is worked out on
 * every frame (lib/readalong/player.ts).
 */
export function ListenBar({
  bookId,
  startCfi,
  onWord,
  onPassage,
  onClose,
}: {
  bookId: string;
  startCfi: string;
  /** Highlight a word of a paragraph (character offsets into its text); returns the word's text, or null if it is not on the page yet. */
  onWord: (passageCfi: string, from: number, to: number) => string | null;
  onPassage: (passageCfi: string) => void;
  onClose: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [voice, setVoice] = useState<string>("");
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [word, setWord] = useState("");
  const [passageCfi, setPassageCfi] = useState("");
  const lastWord = useRef(-1);
  const [at] = useState(startCfi);
  /** Where the audiobook is: the paragraph (index into its list) and the file in the audio element (-1: none). */
  const book = useRef({ index: 0, file: -1 });
  /** The paragraph whose page was last turned to (it can be turned to before its first word). */
  const shown = useRef(-1);
  const [bookEnded, setBookEnded] = useState(false);
  const isBook = !!info?.audiobook && voice === info.audiobook.voice;

  // The paragraph at the reading position, the voices, any stored audio, and the book's own audiobook.
  useEffect(() => {
    let live = true;
    fetch(`/api/books/${bookId}/audio?${new URLSearchParams({ cfi: at })}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setError(body.error ?? "Nothing to read aloud here.");
        else {
          const b = body as Info;
          setInfo(b);
          // The audiobook first, when it goes on from here; otherwise the first made-on-demand voice.
          const made = b.voices.find((v) => !v.id.startsWith("upload:"));
          setVoice(b.audiobook?.paragraphs.length ? b.audiobook.voice : (made ?? b.voices[0])?.id ?? "");
        }
      })
      .catch(() => live && setError("Reading aloud could not start."));
    return () => {
      live = false;
    };
  }, [bookId, at]);

  /** The stored track for a paragraph in the chosen voice, made now if needed. */
  const trackFor = async (sectionId: string, v: string) => {
    const res = await fetch(`/api/books/${bookId}/audio`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sectionId, voice: v }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "This paragraph could not be read aloud.");
    return body.track as Track & { audioUrl: string };
  };

  const playTrack = async (passage: Passage, track: Track & { audioUrl: string }) => {
    const el = audio.current!;
    setInfo((i) => (i ? { ...i, passage, track } : i));
    lastWord.current = -1;
    setPassageCfi(passage.cfi);
    onPassage(passage.cfi);
    el.src = track.audioUrl;
    el.defaultPlaybackRate = speed;
    el.playbackRate = speed;
    await el.play();
  };

  const play = async () => {
    if (!info) return;
    const el = audio.current!;
    if (info.track && el.src && !el.ended) {
      await el.play();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const track = info.track && info.track.voice === voice ? info.track : await trackFor(info.passage.id, voice);
      await playTrack(info.passage, track);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // When a paragraph ends, read on.
  const next = async () => {
    if (!info?.passage.nextId) {
      setPlaying(false);
      return;
    }
    try {
      const res = await fetch(`/api/books/${bookId}/audio?${new URLSearchParams({ section: info.passage.nextId, voice })}`);
      const body = (await res.json()) as Info;
      if (!res.ok) throw new Error("The next paragraph could not be found.");
      const track = body.track ?? (await trackFor(body.passage.id, voice));
      await playTrack(body.passage, track);
    } catch (e) {
      setPlaying(false);
      setError((e as Error).message);
    }
  };

  /** A play() that did not start: say so, unless a newer load or a pause took its place. */
  const playFailed = (e: unknown) => {
    if ((e as Error)?.name === "AbortError") return;
    setPlaying(false);
    setError(
      (e as Error)?.name === "NotAllowedError" ? "Your browser stopped the audiobook from going on by itself: press Play to go on." : "Your audiobook could not be played.",
    );
  };

  /**
   * Plays the audiobook from paragraph `i`'s first word. Everything up to
   * play() happens at once, inside the click when there is one: Safari lets
   * audio start only from a tap or click, and a wait in between loses it.
   * Setting the time before the file has loaded is allowed: the audio starts
   * there once it has.
   */
  const playAudiobookFrom = (i: number) => {
    const el = audio.current!;
    const ab = info!.audiobook!;
    const p = ab.paragraphs[i];
    if (book.current.file !== p.file) el.src = ab.files[p.file].url;
    el.currentTime = p.startMs / 1000;
    // A new file resets the speed to the default one.
    el.defaultPlaybackRate = speed;
    el.playbackRate = speed;
    book.current = { index: i, file: p.file };
    lastWord.current = -1;
    setPassageCfi(p.cfi);
    shown.current = i;
    onPassage(p.cfi);
    return el.play();
  };

  const playAudiobook = () => {
    const el = audio.current!;
    const ab = info!.audiobook!;
    setError(null);
    setBookEnded(false);
    // Paused part-way: go on from there.
    const p = ab.paragraphs[book.current.index];
    const run = book.current.file === p.file && el.src && !el.ended ? el.play() : playAudiobookFrom(book.current.index);
    run.catch(playFailed);
  };

  /** Where the audiobook is, on every frame: turn to its paragraph, light up its word, skip or change files when the plan says. */
  const followBook = () => {
    const el = audio.current;
    const ab = info?.audiobook;
    if (!el || !ab?.paragraphs.length || book.current.file < 0) return;
    // Not while a file loads or a seek runs: the time is not settled yet.
    if (el.readyState < 1 || el.seeking) return;
    const s = followAudiobook(ab.paragraphs, book.current.index, book.current.file, el.currentTime * 1000);
    if (s.kind === "load") {
      playAudiobookFrom(s.index).catch(playFailed);
      return;
    }
    if (s.index !== book.current.index) {
      book.current.index = s.index;
      lastWord.current = -1;
      setPassageCfi(ab.paragraphs[s.index].cfi);
      if (shown.current !== s.index) {
        shown.current = s.index;
        onPassage(ab.paragraphs[s.index].cfi);
      }
    }
    if (s.kind === "seek") {
      el.currentTime = s.toMs / 1000;
      return;
    }
    // This paragraph is over: open the next one's page (a new chapter loads meanwhile).
    if (s.ahead !== null && shown.current !== s.ahead) {
      shown.current = s.ahead;
      onPassage(ab.paragraphs[s.ahead].cfi);
    }
    if (s.word < 0 || s.word === lastWord.current) return;
    const p = ab.paragraphs[s.index];
    const [, , from, to] = p.words[s.word];
    const text = onWord(p.cfi, from, to);
    // Not on the page yet (a chapter still opening): try again on the next frame.
    if (text === null) return;
    lastWord.current = s.word;
    setWord(text);
  };

  const followTrack = () => {
    const el = audio.current;
    const t = info?.track;
    if (!el || !t || !info) return;
    const i = wordAt(t.words, el.currentTime * 1000);
    if (i < 0 || i === lastWord.current) return;
    const [, , from, to] = t.words[i];
    const text = onWord(info.passage.cfi, from, to);
    if (text === null) return;
    lastWord.current = i;
    setWord(text);
  };

  const follow = () => (isBook ? followBook() : followTrack());

  // "timeupdate" fires only about every quarter second, while many words are
  // shorter than that, so while playing, follow the clock on every frame
  // (each time the screen is redrawn, about 60 times a second).
  const followRef = useRef(follow);
  followRef.current = follow;
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      followRef.current();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const onEnded = () => {
    if (!isBook) {
      void next();
      return;
    }
    const el = audio.current;
    const ab = info?.audiobook;
    // A load of the next file may already have replaced the one that ended.
    if (!el?.ended || !ab) return;
    const i = afterEnded(ab.paragraphs, book.current.index, book.current.file);
    if (i === null) {
      setPlaying(false);
      setBookEnded(true);
      return;
    }
    playAudiobookFrom(i).catch(playFailed);
  };

  const onAudioError = () => {
    if (!isBook) return;
    setPlaying(false);
    // The next Play loads the file again.
    book.current.file = -1;
    setError(
      typeof navigator !== "undefined" && !navigator.onLine
        ? "Your audiobook plays only with an internet connection: it is not saved for reading offline."
        : "Your audiobook could not be played. Reload the page and try again.",
    );
  };

  const changeVoice = (v: string) => {
    audio.current?.pause();
    if (audio.current) audio.current.removeAttribute("src");
    book.current.file = -1;
    // Show "Play" at once: the audio's own pause event comes a moment later.
    setPlaying(false);
    setBookEnded(false);
    setError(null);
    setVoice(v);
    // The audiobook is already here: nothing to ask for.
    if (v.startsWith("upload:")) return;
    setInfo((i) => (i ? { ...i, track: i.track?.voice === v ? i.track : null } : i));
    // Audio saved earlier in this voice plays for free: ask for it.
    const id = info?.passage.id;
    if (!id) return;
    void fetch(`/api/books/${bookId}/audio?${new URLSearchParams({ section: id, voice: v })}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Info | null) => {
        if (b?.track) setInfo((i) => (i && i.passage.id === id ? { ...i, track: b.track } : i));
      })
      .catch(() => {});
  };

  const note = error
    ? error
    : !info
      ? "Finding where you are…"
      : isBook
        ? !info.audiobook!.paragraphs.length
          ? "Your audiobook ends before this part of the book."
          : bookEnded
            ? "That is the end of your audiobook."
            : "Your audiobook: free to play."
        : info.estimate === null
          ? "Reading aloud is not set up yet: the owner needs to add an ElevenLabs key."
          : info.track && info.track.voice === voice
            ? "Saved audio: free to play."
            : `This paragraph costs ${usd(info.estimate)} to read aloud; then it is saved.`;

  return (
    <div className={styles.listenBar} role="region" aria-label="Read aloud" data-word={word} data-passage={passageCfi}>
      <audio
        ref={audio}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={follow}
        onSeeked={follow}
        onEnded={onEnded}
        onError={onAudioError}
      />
      <button
        type="button"
        className={styles.primaryTool}
        disabled={!info || busy || (isBook ? !info.audiobook!.paragraphs.length : info.estimate === null && !info.track)}
        onClick={() => (playing ? audio.current?.pause() : isBook ? playAudiobook() : void play())}
      >
        {busy ? "Preparing…" : playing ? "Pause" : "Play"}
      </button>
      {info && info.voices.length ? (
        <label className={styles.listenField}>
          <span>Voice</span>
          <select value={voice} onChange={(e) => changeVoice(e.target.value)}>
            {info.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className={styles.listenField}>
        <span>Speed</span>
        <select
          value={speed}
          onChange={(e) => {
            const s = Number(e.target.value);
            setSpeed(s);
            if (audio.current) {
              audio.current.defaultPlaybackRate = s;
              audio.current.playbackRate = s;
            }
          }}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <p className={styles.listenNote} aria-live="polite">
        {note}
      </p>
      <button type="button" className={`${styles.tool} ${styles.listenClose}`} aria-label="Stop reading aloud" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
