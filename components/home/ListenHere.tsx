"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePlayer } from "@/components/player/PlayerProvider";
import { firstVoice, type Info } from "@/lib/player/session";

/**
 * Home's "Listen from here" (M14 step 6b). For a book with its own
 * audiobook, a tap reads it aloud here, from the reading position, in the
 * mini-player. Its Listen data is fetched while Home is open, so the tap
 * itself can start the audio (Safari starts audio only from a tap or click).
 * Until then, and for a made voice (its price is shown before it first plays:
 * Open unknowns row 10, default (a)), it opens the reader with the Read aloud
 * bar, as before.
 */
export function ListenHere({ bookId, at, className, children }: { bookId: string; at: string | null; className: string; children: ReactNode }) {
  const player = usePlayer();
  const [ready, setReady] = useState<Info | null>(null);
  useEffect(() => {
    if (!at) return;
    let live = true;
    fetch(`/api/books/${bookId}/audio?${new URLSearchParams({ cfi: at })}`)
      .then((res) => (res.ok ? (res.json() as Promise<Info>) : null))
      .then((info) => {
        // Only when the book's own audiobook is the voice that would play first.
        if (live && info?.audiobook && firstVoice(info) === info.audiobook.voice) setReady(info);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [bookId, at]);
  return (
    <Link
      href={`/books/${bookId}/read?listen=1`}
      className={className}
      data-here={ready ? "" : undefined}
      onClick={(e) => {
        // A click meant for a new tab or window still opens the reader there.
        if (!ready || !at || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        player.playHere(bookId, at, ready);
      }}
    >
      {children}
    </Link>
  );
}
