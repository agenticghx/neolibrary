"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReadingPart, Track } from "@/lib/library/audio";
import { mark } from "@/lib/perf-marks";
import { ASK_AGAIN_MS, ASK_MORE_AT, firstVoice, loadSpeed, LOADING_AFTER_MS, noteFor, OFFLINE, saveSpeed, shortChapter, speedLabel, withPart, type Info } from "@/lib/player/session";
import { afterEnded, fileStart, follow as followAudiobook } from "@/lib/readalong/player";
import { wordAt } from "@/lib/speech/timings";
import { sentenceAt } from "@/lib/player/sentence";
import { skipAcross, skipInClip } from "@/lib/player/skip";
import { MiniPlayer, type MiniView } from "./MiniPlayer";
import type { ListenView, PlayerPage } from "./PlayerProvider";

type Passage = Info["passage"];
const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

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
 *
 * One session per opening of Listen (M14 step 6a): it lives in the app's
 * PlayerProvider, so it goes on when the reader is left. The page showing the
 * book (`page`) lights the words, turns the pages and draws the bar; without
 * one the audio plays on, and the word is lit again once a page is back.
 */
export function ListenSession({
  bookId,
  startCfi,
  page,
  miniSlot,
  onStarted,
  prepared,
  playRef,
}: {
  bookId: string;
  startCfi: string;
  page: PlayerPage | null;
  /** Where the mini-player is drawn away from the reader (M14 step 6b): the app's pages give one; the reader does not. */
  miniSlot: HTMLElement | null;
  /** It has played (so it goes on when the reader is left). */
  onStarted: () => void;
  /** Started on Home (M14 step 6b): the Listen data, fetched before the tap. It plays as it mounts. */
  prepared?: Info;
  /** Where the session puts its Play for the provider's resume (Home's Listen from here for this book). */
  playRef?: { current: (() => void) | null };
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [info, setInfo] = useState<Info | null>(prepared ?? null);
  const [voice, setVoice] = useState<string>(() => (prepared ? firstVoice(prepared) : ""));
  // The speed chosen last on this device (M14 step 6b), applied after every new source.
  const [speed, setSpeed] = useState(loadSpeed);
  /** The speed now, for audio started after a wait (a speed chosen while it was being prepared must hold). */
  const speedNow = useRef(speed);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passageCfi, setPassageCfi] = useState("");
  /** The paragraph being read, for a page that comes back while it plays. */
  const passage = useRef("");
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
  /** The audiobook has played in this session (so the note no longer says where it begins). */
  const [bookStarted, setBookStarted] = useState(false);
  const isBook = !!info?.audiobook && voice === info.audiobook.voice;

  /** The page showing the book, if any (the reader, while it is open). */
  const pageRef = useRef<PlayerPage | null>(null);
  const onWord = (passageCfi: string, from: number, to: number, inPage?: [number, number]) => pageRef.current?.onWord(passageCfi, from, to, inPage) ?? null;
  const onPassage = (passageCfi: string, opts?: { resume?: boolean }) => pageRef.current?.onPassage(passageCfi, opts);
  const reading = (cfi: string) => {
    passage.current = cfi;
    setPassageCfi(cfi);
  };
  /**
   * Away from the page (M14 step 6b): the paragraph being read, its chapter,
   * and the word being said in it (`from`/`to`, offsets into `text`; -1:
   * none yet), worked out from the word times alone, for the mini-player.
   */
  const [heard, setHeard] = useState<{ text: string; chapter: string; from: number; to: number } | null>(null);
  /** Minutes left in the audiobook's file (at this speed), for the mini-player; null for a made voice. */
  const [left, setLeft] = useState<number | null>(null);
  const leftShown = useRef<number | null>(null);
  const howLong = (el: HTMLAudioElement) => {
    const m = Number.isFinite(el.duration) && el.duration > 0 ? Math.max(0, Math.ceil((el.duration - el.currentTime) / (el.playbackRate || 1) / 60)) : null;
    if (m !== leftShown.current) {
      leftShown.current = m;
      setLeft(m);
    }
  };
  /** Listening away from the reader, the reading position follows the voice, paragraph by paragraph. */
  const savedAt = useRef("");
  const savePlace = (sectionId: string) => {
    if (pageRef.current || savedAt.current === sectionId) return;
    savedAt.current = sectionId;
    void fetch(`/api/books/${bookId}/position`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sectionId }),
      keepalive: true,
    }).catch(() => {});
  };
  /**
   * Leaving the page: the mini-player starts from where the audio is now,
   * paused or playing (its paragraph, the word at that moment, the minutes
   * left), not from where Listen was opened.
   */
  const showWhereItIs = () => {
    const el = audio.current;
    const ab = info?.audiobook;
    if (!el || !info) return;
    if (isBook && ab?.paragraphs.length) {
      const p = ab.paragraphs[Math.min(book.current.index, ab.paragraphs.length - 1)];
      const w = book.current.file === p.file && el.readyState >= 1 ? wordAt(p.words, el.currentTime * 1000) : -1;
      setHeard({ text: p.text, chapter: ab.chapters[p.chapterIndex] ?? "", from: w >= 0 ? p.words[w][2] : -1, to: w >= 0 ? p.words[w][3] : -1 });
      if (el.readyState >= 1) howLong(el);
    } else if (info.track) {
      const w = el.readyState >= 1 ? wordAt(info.track.words, el.currentTime * 1000) : -1;
      setHeard({ text: info.passage.text, chapter: info.passage.chapter, from: w >= 0 ? info.track.words[w][2] : -1, to: w >= 0 ? info.track.words[w][3] : -1 });
    }
  };
  const whereItIs = useRef(showWhereItIs);
  whereItIs.current = showWhereItIs;
  useEffect(() => {
    pageRef.current = page;
    // Away from the page: the mini-player shows where the audio is, and the word being said from the next frame on.
    if (!page) {
      lastWord.current = -1;
      whereItIs.current();
      return;
    }
    // Back on the book while it reads aloud: show where it is; the word is lit again on the next frame.
    if (!passage.current) return;
    lastWord.current = -1;
    shown.current = book.current.index;
    page.onPassage(passage.current, { resume: true });
  }, [page]);

  // The paragraph at the reading position, the voices, any stored audio, and the book's own audiobook.
  useEffect(() => {
    if (prepared) return;
    let live = true;
    fetch(`/api/books/${bookId}/audio?${new URLSearchParams({ cfi: at })}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setError(body.error ?? "Nothing to read aloud here.");
        else {
          const b = body as Info;
          setInfo(b);
          setVoice(firstVoice(b));
        }
      })
      .catch(() => live && setError(offline() ? OFFLINE : "Reading aloud could not start."));
    return () => {
      live = false;
    };
  }, [bookId, at, prepared]);

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

  const playTrack = async (passage: Passage, track: Track & { audioUrl: string }, startMs = 0, resume = true) => {
    const el = audio.current!;
    setInfo((i) => (i ? { ...i, passage, track } : i));
    lastWord.current = -1;
    reading(passage.cfi);
    setHeard({ text: passage.text, chapter: passage.chapter, from: -1, to: -1 });
    savePlace(passage.id);
    onPassage(passage.cfi);
    el.src = track.audioUrl;
    // Back 15 s into the paragraph before: its time is set as soon as its length is known, before any
    // of it is heard (WebKit on Linux stalls on a time set earlier than that, as playAudiobookFrom says).
    if (startMs > 0) {
      const src = el.src;
      el.addEventListener("loadedmetadata", () => el.src === src && (el.currentTime = startMs / 1000), { once: true });
    }
    el.defaultPlaybackRate = speedNow.current;
    el.playbackRate = speedNow.current;
    // A skip made while paused moves without playing.
    if (resume) await el.play();
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

  // When a paragraph ends, read on (`resume`: playing; a skip made while paused moves without playing).
  const next = async (resume = true) => {
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
      await playTrack(body.passage, track, 0, resume);
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
  /**
   * Plays the audiobook from paragraph `i`: from its start, from where playing starts its file (`fromFileStart`),
   * or from `startMs` (a skip into another file). `resume` false: load it there and stay paused.
   */
  const playAudiobookFrom = (i: number, fromFileStart = false, startMs?: number, resume = true) => {
    const el = audio.current!;
    const ab = info!.audiobook!;
    const p = ab.paragraphs[i];
    const at = (startMs ?? (fromFileStart ? fileStart(p) : p.startMs)) / 1000;
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
    el.defaultPlaybackRate = speedNow.current;
    el.playbackRate = speedNow.current;
    book.current = { index: i, file: p.file, played: true, settling };
    setBookStarted(true);
    lastWord.current = -1;
    reading(p.cfi);
    // Away from the page, the mini-player shows this paragraph at once: following only notices a change of
    // paragraph, and this one is set here (a skip may land where no word is being said).
    if (!pageRef.current) setHeard({ text: p.text, chapter: ab.chapters[p.chapterIndex] ?? "", from: -1, to: -1 });
    shown.current = i;
    onPassage(p.cfi);
    return resume ? el.play() : Promise.resolve();
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

  /** Asks for the next part of the audiobook's paragraphs, and adds it to the list the session has. */
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
          ? { ...i, audiobook: withPart(i.audiobook, part) }
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
      // On into the next file; paused (a seek moved it here), it stays paused.
      playAudiobookFrom(s.index, true, undefined, !el.paused).catch(playFailed);
      return;
    }
    if (s.index !== book.current.index) {
      book.current.index = s.index;
      lastWord.current = -1;
      reading(ab.paragraphs[s.index].cfi);
      if (!pageRef.current) {
        const p = ab.paragraphs[s.index];
        setHeard({ text: p.text, chapter: ab.chapters[p.chapterIndex] ?? "", from: -1, to: -1 });
        savePlace(p.sectionId);
      }
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
    if (!pageRef.current) howLong(el);
    if (s.word < 0 || s.word === lastWord.current) return;
    const p = ab.paragraphs[s.index];
    const [, , from, to] = p.words[s.word];
    // Away from the page: the word comes from its times and the paragraph's text; nothing waits for a page.
    if (!pageRef.current) {
      setHeard({ text: p.text, chapter: ab.chapters[p.chapterIndex] ?? "", from, to });
      savePlace(p.sectionId);
      lastWord.current = s.word;
      return;
    }
    const text = onWord(p.cfi, from, to, p.inPage?.[s.word]);
    // Not on the page yet (a chapter or PDF page still opening): try again on the next frame.
    if (text === null) {
      mark("nl:word-wait", { i: s.word });
      return;
    }
    lastWord.current = s.word;
  };

  const followTrack = () => {
    const el = audio.current;
    const t = info?.track;
    // Not the audio loaded now: a new paragraph was just loaded (its "timeupdate" back to 0 can come before
    // the next render), and this one's words would light its first word in the paragraph before.
    if (!el || !t || !info || el.getAttribute("src") !== t.audioUrl) return;
    const i = wordAt(t.words, el.currentTime * 1000);
    if (i < 0 || i === lastWord.current) return;
    const [, , from, to] = t.words[i];
    // Away from the page: the word comes from its times and the paragraph's text.
    if (!pageRef.current) {
      setHeard({ text: info.passage.text, chapter: info.passage.chapter, from, to });
      lastWord.current = i;
      return;
    }
    if (onWord(info.passage.cfi, from, to) === null) return;
    lastWord.current = i;
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
    book.current.settling = false;
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
    book.current.settling = false;
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

  /** A made voice, back past the start of this paragraph: the one before, `fromEndMs` before its end (made now if needed). */
  const readBack = async (sectionId: string, fromEndMs: number, resume: boolean) => {
    const g = generation.current;
    setBusy(true);
    try {
      const res = await fetch(`/api/books/${bookId}/audio?${new URLSearchParams({ section: sectionId, voice })}`);
      const body = (await res.json()) as Info;
      if (!res.ok) throw new Error("The paragraph before could not be found.");
      const track = body.track ?? (await trackFor(body.passage.id, voice));
      if (generation.current !== g) return;
      await playTrack(body.passage, track, Math.max(0, track.durationMs - fromEndMs), resume);
    } catch (e) {
      if (generation.current !== g) return;
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Back or forward 15 s (M14 step 6b). An audiobook moves within the file
   * playing, counting only what plays (lib/player/skip.ts); a made voice
   * moves within its paragraph, or on to the one before or after.
   */
  const skip = (seconds: number) => {
    const el = audio.current;
    if (!el?.src || el.readyState < 1 || (isBook && book.current.settling) || !info) return;
    const t = el.currentTime * 1000;
    const endMs = Number.isFinite(el.duration) ? el.duration * 1000 : t + Math.abs(seconds) * 1000 + 1;
    lastWord.current = -1;
    if (isBook && info.audiobook) {
      const s = skipAcross(info.audiobook.paragraphs, book.current.index, book.current.file, t, seconds * 1000, endMs);
      if (s.kind === "seek") {
        el.currentTime = s.toMs / 1000;
        return;
      }
      // Into the next file or the one before (M14 step 6b, part 2b): loaded there, playing on only if it was;
      // away from the reader, the reading position follows.
      playAudiobookFrom(s.index, false, s.toMs, !el.paused).catch(playFailed);
      savePlace(info.audiobook.paragraphs[s.index].sectionId);
      return;
    }
    const s = skipInClip(t, seconds * 1000, endMs, { prev: !!info.passage.prevId, next: !!info.passage.nextId });
    if (s.kind === "seek") {
      el.currentTime = s.toMs / 1000;
      return;
    }
    // Into the paragraph before or after: this clip stops first (else its own end would read on as well).
    const resume = !el.paused;
    el.pause();
    if (s.kind === "next") void next(resume);
    else void readBack(info.passage.prevId!, s.fromEndMs, resume);
  };

  const view: ListenView = {
    passageCfi,
    playing,
    busy,
    disabled: !info || busy || (isBook ? !info.audiobook!.paragraphs.length : info.estimate === null && !info.track),
    voices: info?.voices ?? [],
    voice,
    speed,
    note: noteFor({ error, info, isBook, voice, bookEnded, loading, bookStarted }),
    toggle: () => (playing ? audio.current?.pause() : isBook ? playAudiobook() : void play()),
    changeVoice,
    setSpeed: (s) => {
      setSpeed(s);
      speedNow.current = s;
      saveSpeed(s);
      if (audio.current) {
        audio.current.defaultPlaybackRate = s;
        audio.current.playbackRate = s;
        // Away from the page, the minutes left follow the new speed (no frame runs while paused).
        if (!pageRef.current && isBook) howLong(audio.current);
      }
    },
  };

  // The mini-player (M14 step 6b): the sentence being read with its word lit, the book, where and how long.
  const firstText = isBook ? info?.audiobook?.paragraphs[0]?.text : info?.passage.text;
  const shownText = heard?.text ?? firstText ?? "";
  const lit = heard && heard.from >= 0 ? heard : null;
  const around = sentenceAt(shownText, lit ? lit.from : 0);
  const firstChapter = isBook ? (info?.audiobook?.chapters[info.audiobook.paragraphs[0]?.chapterIndex ?? -1] ?? "") : (info?.passage.chapter ?? "");
  const mini: MiniView = {
    title: info?.book.title ?? "",
    // What went wrong, or that the audiobook is loading (the reader's bar says the rest; the design has no line for it).
    status: error ?? (isBook && loading ? "Loading your audiobook…" : ""),
    sentence: shownText.slice(around.start, around.end),
    lit: lit ? [lit.from - around.start, lit.to - around.start] : null,
    chapter: shortChapter(heard ? heard.chapter : firstChapter),
    left: isBook && left !== null ? `${left} min left` : "",
    atSpeed: speed === 1 ? "" : ` at ${speedLabel(speed)}`,
    playing,
    busy,
    disabled: view.disabled,
    speed,
    toggle: view.toggle,
    back: () => skip(-15),
    forward: () => skip(15),
    setSpeed: view.setSpeed,
    pageHref: `/books/${bookId}/read?at=${encodeURIComponent(passageCfi || at)}`,
    // Think aloud (M14 step 6c): the reading pauses; the voice note goes to the paragraph being read, and quotes
    // the sentence shown.
    thinkAloud: () => {
      const el = audio.current;
      const wasPlaying = !!el && !el.paused;
      el?.pause();
      const ab = info?.audiobook;
      const cfi = isBook && ab?.paragraphs.length ? ab.paragraphs[Math.min(book.current.index, ab.paragraphs.length - 1)].cfi : (info?.passage.cfi ?? at);
      return { wasPlaying, cfi, quote: shownText.slice(around.start, around.end) };
    },
    saveThought: async (recording, durationMs, place) => {
      const form = new FormData();
      form.set("audio", recording, "voice-note");
      form.set("cfi", place.cfi);
      form.set("quote", JSON.stringify({ exact: place.quote }));
      form.set("durationMs", String(Math.round(durationMs)));
      const res = await fetch(`/api/books/${bookId}/voice-notes`, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The voice note was not saved.");
    },
  };

  // Started on Home: Play is pressed as the session mounts, while the tap that started it is still being
  // handled (a layout effect runs inside the provider's flushSync), so Safari lets it play.
  const pressPlay = useRef(!!prepared);
  useLayoutEffect(() => {
    if (!pressPlay.current) return;
    pressPlay.current = false;
    // Only as the button could be pressed (Home checks first: lib/player/session.ts, playsHere).
    if (!view.disabled) view.toggle();
  });
  // Play for the provider's resume: only when paused, and only as the button could be pressed.
  useLayoutEffect(() => {
    if (!playRef) return;
    const go = () => {
      if (!playing && !view.disabled) view.toggle();
    };
    playRef.current = go;
    return () => {
      if (playRef.current === go) playRef.current = null;
    };
  });

  return (
    <>
      <audio
        ref={audio}
        onPlay={() => {
          setPlaying(true);
          onStarted();
        }}
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
      {page ? createPortal(page.renderBar(view), page.slot) : miniSlot ? createPortal(<MiniPlayer view={mini} />, miniSlot) : null}
    </>
  );
}
