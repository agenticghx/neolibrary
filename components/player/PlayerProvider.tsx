"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ListenSession } from "./ListenSession";

/** What the bar shows and can do, for the page that draws it (the reader's ListenBar). */
export type ListenView = {
  /** The paragraph being read (data-passage, read by the tests). */
  passageCfi: string;
  playing: boolean;
  /** Audio is being fetched or made. */
  busy: boolean;
  /** Play cannot be pressed: nothing to play yet, or it is being prepared. */
  disabled: boolean;
  voices: { id: string; name: string }[];
  voice: string;
  speed: number;
  /** The line under the buttons. */
  note: string;
  /** Play, or Pause while playing. Called inside the click: Safari starts audio only from a tap or click. */
  toggle: () => void;
  changeVoice: (voice: string) => void;
  setSpeed: (speed: number) => void;
};

/** What a page showing the book gives the player while it is open (Reader.tsx). */
export type PlayerPage = {
  /** Where the bar is drawn, in the page. */
  slot: HTMLElement;
  /**
   * Highlight a word of a paragraph (character offsets into its text; in a
   * PDF also `inPage`, its place on the page in non-space characters);
   * returns the word's text, or null if it is not on the page yet.
   */
  onWord: (passageCfi: string, from: number, to: number, inPage?: [number, number]) => string | null;
  /** Show a paragraph (turning the page if needed); `resume`: going on after a pause, show the word being read. */
  onPassage: (passageCfi: string, opts?: { resume?: boolean }) => void;
  renderBar: (view: ListenView) => ReactNode;
};

export type Player = {
  /** The book being read aloud now, or null. */
  bookId: string | null;
  /**
   * The page shows the bar for `bookId`: reading aloud starts at `startCfi`
   * unless this book is already being read aloud, in which case it carries
   * on (`fresh`: start at `startCfi` all the same, as "Listen from here"
   * asks). Returns the call that takes the page away again (it does not
   * stop audio that has played: leaving the reader, reading aloud goes on).
   */
  attach: (page: PlayerPage, bookId: string, startCfi: string, fresh?: boolean) => () => void;
  /** Stop reading aloud: the audio goes, as when the bar was closed. */
  stop: () => void;
  /** Where the app's pages put the mini-player (M14 step 6b); returns the call that takes it away. */
  attachMini: (slot: HTMLElement) => () => void;
};

const PlayerContext = createContext<Player | null>(null);

export function usePlayer(): Player {
  const player = useContext(PlayerContext);
  if (!player) throw new Error("usePlayer() outside PlayerProvider");
  return player;
}

/**
 * One read-aloud player for the whole app (M14 step 6a), in the root layout,
 * so the audio goes on when the reader is left for another page. It owns the
 * one <audio> element (first in the page, before everything else) and plays
 * nothing until a reader opens Listen. Signing out (which lands on /sign-in)
 * stops it.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  /** `started`: it has played. Only then does it outlive the reader (one never played would come back later with stale data). */
  const [session, setSession] = useState<{ id: number; bookId: string; startCfi: string; started: boolean } | null>(null);
  const [page, setPage] = useState<PlayerPage | null>(null);
  const [miniSlot, setMiniSlot] = useState<HTMLElement | null>(null);
  const nextId = useRef(0);

  // Signed out: nothing plays on the sign-in page. (Adjusting state to a new
  // address while rendering, not in an effect, so no frame plays after it.)
  const pathname = usePathname();
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (pathname === "/sign-in" && session) setSession(null);
  }

  const attach = useCallback((p: PlayerPage, bookId: string, startCfi: string, fresh = false) => {
    const id = ++nextId.current;
    setSession((s) => (s?.bookId === bookId && !fresh ? s : { id, bookId, startCfi, started: false }));
    setPage(p);
    return () => {
      setPage((current) => (current === p ? null : current));
      setSession((s) => (s && s.bookId === bookId && !s.started ? null : s));
    };
  }, []);
  const started = useCallback((id: number) => setSession((s) => (s && s.id === id && !s.started ? { ...s, started: true } : s)), []);
  const stop = useCallback(() => setSession(null), []);
  const attachMini = useCallback((slot: HTMLElement) => {
    setMiniSlot(slot);
    return () => setMiniSlot((current) => (current === slot ? null : current));
  }, []);
  const bookId = session?.bookId ?? null;
  const player = useMemo(() => ({ bookId, attach, stop, attachMini }), [bookId, attach, stop, attachMini]);

  return (
    <PlayerContext.Provider value={player}>
      {session ? (
        <ListenSession
          key={session.id}
          bookId={session.bookId}
          startCfi={session.startCfi}
          page={page}
          miniSlot={miniSlot}
          onStarted={() => started(session.id)}
        />
      ) : null}
      {children}
    </PlayerContext.Provider>
  );
}
