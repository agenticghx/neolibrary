"use client";

import { useEffect, useRef, useState } from "react";
import type { Track } from "@/lib/library/audio";
import { wordAt } from "@/lib/speech/timings";
import styles from "./reader.module.css";

type Passage = { id: string; cfi: string; nextId: string | null; characters: number };
type Info = { passage: Passage; voices: { id: string; name: string }[]; track: (Track & { audioUrl: string }) | null; estimate: number | null };

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);

/**
 * Read aloud (M7): plays the paragraph at the reading position, then the
 * next, one paragraph of audio at a time (made on first play, stored after),
 * and highlights each word as it is spoken.
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
  /** Highlight a word of a paragraph (character offsets into its text); returns the word's text. */
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
  const lastWord = useRef(-1);
  const [at] = useState(startCfi);

  // The paragraph at the reading position, the voices, and any stored audio.
  useEffect(() => {
    let live = true;
    fetch(`/api/books/${bookId}/audio?${new URLSearchParams({ cfi: at })}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setError(body.error ?? "Nothing to read aloud here.");
        else {
          setInfo(body);
          setVoice(body.voices[0]?.id ?? "");
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
    onPassage(passage.cfi);
    el.src = track.audioUrl;
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

  const follow = () => {
    const el = audio.current;
    const t = info?.track;
    if (!el || !t || !info) return;
    const i = wordAt(t.words, el.currentTime * 1000);
    if (i < 0 || i === lastWord.current) return;
    lastWord.current = i;
    const [, , from, to] = t.words[i];
    setWord(onWord(info.passage.cfi, from, to) ?? "");
  };

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

  const changeVoice = (v: string) => {
    audio.current?.pause();
    if (audio.current) audio.current.removeAttribute("src");
    // Show "Play" at once: the audio's own pause event comes a moment later.
    setPlaying(false);
    setVoice(v);
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

  return (
    <div className={styles.listenBar} role="region" aria-label="Read aloud" data-word={word}>
      <audio
        ref={audio}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={follow}
        onSeeked={follow}
        onEnded={() => void next()}
      />
      <button
        type="button"
        className={styles.primaryTool}
        disabled={!info || busy || (info.estimate === null && !info.track)}
        onClick={() => (playing ? audio.current?.pause() : void play())}
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
            if (audio.current) audio.current.playbackRate = s;
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
        {error
          ? error
          : !info
            ? "Finding where you are…"
            : info.estimate === null
              ? "Reading aloud is not set up yet: the owner needs to add an ElevenLabs key."
              : info.track && info.track.voice === voice
                ? "Saved audio: free to play."
                : `This paragraph costs ${usd(info.estimate)} to read aloud; then it is saved.`}
      </p>
      <button type="button" className={`${styles.tool} ${styles.listenClose}`} aria-label="Stop reading aloud" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
