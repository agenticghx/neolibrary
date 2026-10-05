"use client";

import { useEffect, useRef, useState } from "react";
import type { ReadingPart, Track } from "@/lib/library/audio";
import type { ListenInfo } from "@/lib/library/listen";
import { afterEnded, fileStart, follow as followAudiobook } from "@/lib/readalong/player";
import { wordAt } from "@/lib/speech/timings";
import styles from "./reader.module.css";

type Passage = ListenInfo["passage"];
type Info = Omit<ListenInfo, "track"> & { track: (Track & { audioUrl: string }) | null };

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);
/** The audiobook's next paragraphs are asked for when this few are left in the part the bar has. */
const ASK_MORE_AT = 40;
/** A part that could not be fetched is asked for again after this long. */
const ASK_AGAIN_MS = 5000;
/** Waiting for audio shorter than this is not mentioned (Chromium waits briefly on every seek). */
const LOADING_AFTER_MS = 600;
const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const OFFLINE = "Reading aloud needs an internet connection: the audio is not saved for reading offline.";

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
  /** Show a paragraph (turning the page if needed); `resume`: going on after a pause, show the word being read. */
  onPassage: (passageCfi: string, opts?: { resume?: boolean }) => void;
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
  const [loading, setLoading] = useState(false);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWord = useRef(-1);
  const [at] = useState(startCfi);
  /**
   * Where the audiobook is: the paragraph (index into its list), the file in
   * the audio element (-1: none), whether it has played, and whether its
   * start time is still to be set (the file is loading).
   */
  const book = useRef({ index: 0, file: -1, played: false, settling: false });
  /** The paragraph whose page was last turned to (it can be turned to before its first word). */
  const shown = useRef(-1);
  /** Changes with every change of voice, so audio still being fetched for the old voice is dropped. */
  const generation = useRef(0);
  /** Asking for the audiobook's next part: not twice at once, nor again too soon after a failure. */
  const asking = useRef({ now: false, retryAt: 0 });
  const [bookEnded, setBookEnded] = useState(false);
  /** The audiobook has played in this bar (so the note no longer says where it begins). */
  const [bookStarted, setBookStarted] = useState(false);
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
          // The audiobook first when it goes on from near here; otherwise the first made-on-demand voice.
          const made = b.voices.find((v) => !v.id.startsWith("upload:"));
          const ab = b.audiobook;
          const bookFirst = ab && ab.paragraphs.length && (!ab.begins || ab.begins.nearby || !made);
          setVoice(bookFirst ? ab.voice : (made ?? b.voices[0])?.id ?? "");
        }
      })
      .catch(() => live && setError(offline() ? OFFLINE : "Reading aloud could not start."));
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
      // Paused part-way: bring the page back if the reader turned away, and go on.
      lastWord.current = -1;
      onPassage(info.passage.cfi, { resume: true });
      await el.play();
      return;
    }
    const g = generation.current;
    setBusy(true);
    setError(null);
    try {
      const track = info.track && info.track.voice === voice ? info.track : await trackFor(info.passage.id, voice);
      if (generation.current !== g) return;
      await playTrack(info.passage, track);
    } catch (e) {
      if (generation.current === g) setError((e as Error).message);
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
    const g = generation.current;
    setBusy(true);
    try {
      const res = await fetch(`/api/books/${bookId}/audio?${new URLSearchParams({ section: info.passage.nextId, voice })}`);
      const body = (await res.json()) as Info;
      if (!res.ok) throw new Error("The next paragraph could not be found.");
      const track = body.track ?? (await trackFor(body.passage.id, voice));
      // The voice was changed meanwhile: this audio is no longer wanted.
      if (generation.current !== g) return;
      await playTrack(body.passage, track);
    } catch (e) {
      if (generation.current !== g) return;
      setPlaying(false);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** A play() that did not start: say so, unless a newer load, a pause, or the audio's own error report took its place. */
  const playFailed = (e: unknown) => {
    if ((e as Error)?.name === "AbortError" || audio.current?.error) return;
    setPlaying(false);
    setError(
      (e as Error)?.name === "NotAllowedError" ? "Your browser stopped the audiobook from going on by itself: press Play to go on." : "Your audiobook could not be played.",
    );
  };

  /**
   * Plays the audiobook from paragraph `i`'s first word, or, reading on into
   * a new file, from the file's beginning (its chapter title), unless a long
   * stretch comes first. play() is called at once, inside the click when
   * there is one: Safari lets audio start only from a tap or click, and a
   * wait in between loses it. A file still loading gets its time as soon as
   * its length is known (before any of it is heard): WebKit on Linux stalls
   * on a time set earlier than that, far into a file (seen on CI).
   */
  const playAudiobookFrom = (i: number, fromFileStart = false) => {
    const el = audio.current!;
    const ab = info!.audiobook!;
    const p = ab.paragraphs[i];
    const at = (fromFileStart ? fileStart(p) : p.startMs) / 1000;
    if (book.current.file !== p.file) el.src = ab.files[p.file].url;
    const settling = el.readyState < 1 && at > 0;
    if (!settling) el.currentTime = at;
    else {
      const src = el.src;
      el.addEventListener(
        "loadedmetadata",
        () => {
          if (el.src !== src) return;
          el.currentTime = at;
          book.current.settling = false;
        },
        { once: true },
      );
    }
    // A new file resets the speed to the default one.
    el.defaultPlaybackRate = speed;
    el.playbackRate = speed;
    book.current = { index: i, file: p.file, played: true, settling };
    setBookStarted(true);
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
    const p = ab.paragraphs[book.current.index];
    if (book.current.file === p.file && el.src && !el.ended) {
      // Paused part-way: bring its page back if the reader turned away, and go on from there.
      lastWord.current = -1;
      shown.current = book.current.index;
      onPassage(p.cfi, { resume: true });
      el.play().catch(playFailed);
      return;
    }
    playAudiobookFrom(book.current.index).catch(playFailed);
  };

  /** Asks for the next part of the audiobook's paragraphs, and adds it to the list the bar has. */
  const askMore = async () => {
    const ab = info?.audiobook;
    if (!ab || ab.more === null || asking.current.now || Date.now() < asking.current.retryAt) return;
    asking.current.now = true;
    try {
      const res = await fetch(`${ab.partsUrl}?${new URLSearchParams({ from: String(ab.more) })}`);
      if (!res.ok) throw new Error(`part ${res.status}`);
      const part = (await res.json()) as ReadingPart;
      setInfo((i) =>
        i?.audiobook && i.audiobook.importId === ab.importId && i.audiobook.more === ab.more
          ? { ...i, audiobook: { ...i.audiobook, paragraphs: [...i.audiobook.paragraphs, ...part.paragraphs], more: part.more } }
          : i,
      );
    } catch {
      asking.current.retryAt = Date.now() + ASK_AGAIN_MS;
    } finally {
      asking.current.now = false;
    }
  };

  /** Where the audiobook is, on every frame: turn to its paragraph, light up its word, skip or change files when the plan says. */
  const followBook = () => {
    const el = audio.current;
    const ab = info?.audiobook;
    if (!el || !ab?.paragraphs.length || book.current.file < 0) return;
    // Not while a file loads, its start time is still to be set, or a seek runs: the time is not settled yet.
    if (el.readyState < 1 || book.current.settling || el.seeking) return;
    const s = followAudiobook(ab.paragraphs, book.current.index, book.current.file, el.currentTime * 1000);
    if (s.kind === "load") {
      playAudiobookFrom(s.index, true).catch(playFailed);
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
    if (ab.more !== null && s.index >= ab.paragraphs.length - ASK_MORE_AT) void askMore();
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
  // (each time the screen is redrawn, about 60 times a second). A failure in
  // one frame (a chapter half-opened, say) must not stop the frames after it.
  const followRef = useRef(follow);
  followRef.current = follow;
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      try {
        followRef.current();
      } catch (e) {
        console.error(e);
      }
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
    if (i !== null) {
      playAudiobookFrom(i, true).catch(playFailed);
      return;
    }
    setPlaying(false);
    // More of the audiobook is still to come, but its paragraphs never arrived.
    if (ab.more !== null) setError("The next part of your audiobook could not be fetched. Close Listen and open it again to go on.");
    else setBookEnded(true);
  };

  const waiting = () => {
    if (!loadingTimer.current) loadingTimer.current = setTimeout(() => setLoading(true), LOADING_AFTER_MS);
  };
  const doneWaiting = () => {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
    loadingTimer.current = null;
    setLoading(false);
  };
  useEffect(() => {
    const timer = loadingTimer;
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onAudioError = () => {
    doneWaiting();
    if (!isBook) return;
    setPlaying(false);
    // The next Play loads the file again.
    book.current.file = -1;
    setError(offline() ? OFFLINE : "Your audiobook could not be played. Reload the page and try again.");
  };

  const changeVoice = (v: string) => {
    // Some browsers report one choice twice; the second must not undo the first's hand-over.
    if (v === voice) return;
    const el = audio.current;
    const ab = info?.audiobook;
    // Hand the place over: a made voice reads on from where the audiobook got to (worked
    // out from the audio's own time, which may be a frame ahead of the last follow), and back.
    let fromBook = null;
    if (isBook && ab?.paragraphs.length && book.current.played) {
      const loaded = el && book.current.file >= 0 && el.readyState >= 1;
      const index = loaded ? followAudiobook(ab.paragraphs, book.current.index, book.current.file, el.currentTime * 1000).index : book.current.index;
      fromBook = ab.paragraphs[index];
    }
    el?.pause();
    el?.removeAttribute("src");
    book.current.file = -1;
    generation.current += 1;
    doneWaiting();
    // Show "Play" at once: the audio's own pause event comes a moment later.
    setPlaying(false);
    setBookEnded(false);
    setError(null);
    setVoice(v);
    if (v.startsWith("upload:")) {
      // The audiobook is already here: from the first of its paragraphs at or after where the made voice was.
      const k = ab && info ? ab.paragraphs.findIndex((p) => p.position >= info.passage.position) : -1;
      if (k >= 0 && !isBook) book.current.index = k;
      return;
    }
    const id = fromBook?.sectionId ?? info?.passage.id;
    if (!id) return;
    setInfo((i) => (i ? { ...i, track: !fromBook && i.track?.voice === v ? i.track : null } : i));
    // The paragraph to read in this voice, and any audio saved for it earlier (it plays for free).
    const g = generation.current;
    if (fromBook) setBusy(true);
    void fetch(`/api/books/${bookId}/audio?${new URLSearchParams({ section: id, voice: v })}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Info | null) => {
        if (!b || generation.current !== g) return;
        setInfo((i) => (i ? { ...i, passage: b.passage, track: b.track, estimate: b.estimate } : i));
      })
      .catch(() => {})
      .finally(() => {
        if (fromBook) setBusy(false);
      });
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
            : loading
              ? "Loading your audiobook…"
              : info.audiobook!.begins && !info.audiobook!.begins.nearby && !bookStarted
                ? `Your audiobook begins further on (${info.audiobook!.begins.label}): Play turns to it.`
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
        onPause={() => {
          setPlaying(false);
          doneWaiting();
        }}
        onWaiting={waiting}
        onPlaying={doneWaiting}
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
