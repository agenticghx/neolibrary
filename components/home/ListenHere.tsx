"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePlayer } from "@/components/player/PlayerProvider";
import { playsHere, type Info } from "@/lib/player/session";

/**
 * The Listen data fetched on Home, kept for a few minutes, so that coming
 * back to Home does not fetch it again (it is up to 8,000 words of text and
 * timings). Four minutes: less than the five-minute life of the signed audio
 * links inside it. A failed fetch is not kept.
 */
const ahead = new Map<string, { at: number; info: Promise<Info | null> }>();
const KEEP_MS = 4 * 60 * 1000;
function listenData(bookId: string, cfi: string) {
  const key = `${bookId}|${cfi}`;
  const kept = ahead.get(key);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.info;
  const info = fetch(`/api/books/${bookId}/audio?${new URLSearchParams({ cfi })}`)
    .then((res) => (res.ok ? (res.json() as Promise<Info>) : null))
    .catch(() => null)
    .then((v) => {
      if (!v) ahead.delete(key);
      return v;
    });
  ahead.set(key, { at: Date.now(), info });
  return info;
}

/**
 * Home's "Listen from here" (M14 step 6b). For a book with its own
 * audiobook, a tap reads it aloud here, from the reading position, in the
 * mini-player. Its Listen data is fetched while Home is open, so the tap
 * itself can start the audio (Safari starts audio only from a tap or click).
 * For the book already in the player, a tap goes on with it. Otherwise it
 * opens the reader with the Read aloud bar, as before: while the data is still
 * coming; when the audiobook ends before the reading position or begins
 * further on (the bar says so: playsHere); and for a made voice, whose price
 * is shown before it first plays (Open unknowns row 10, default (a)).
 */
export function ListenHere({ bookId, at, className, children }: { bookId: string; at: string | null; className: string; children: ReactNode }) {
  const player = usePlayer();
  const [ready, setReady] = useState<Info | null>(null);
  // Said to a screen reader: the link stayed on Home, and the reading is in the player.
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (!at) return;
    let live = true;
    void listenData(bookId, at).then((info) => {
      if (live && info && playsHere(info)) setReady(info);
    });
    return () => {
      live = false;
    };
  }, [bookId, at]);
  return (
    <>
      <Link
        href={`/books/${bookId}/read?listen=1`}
        className={className}
        data-here={ready ? "" : undefined}
        onClick={(e) => {
          // A click meant for a new tab or window still opens the reader there.
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          if (player.bookId === bookId) {
            // Already in the player, its place the reading position: go on with it, not from where Home began.
            e.preventDefault();
            player.resume();
          } else if (ready && at) {
            e.preventDefault();
            player.playHere(bookId, at, ready);
          } else return;
          setSaid("Reading aloud, in the player at the foot of the page.");
        }}
      >
        {children}
      </Link>
      <span role="status" className="visually-hidden">
        {said}
      </span>
    </>
  );
}
