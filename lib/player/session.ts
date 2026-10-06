import type { Track } from "@/lib/library/audio";
import type { ListenInfo } from "@/lib/library/listen";

/**
 * The read-aloud player's rules that need no browser (M14 step 6a): which
 * voice a new session starts with, and what the bar says. The player itself
 * is components/player/ListenSession.tsx; where the audiobook is in the book
 * is lib/readalong/player.ts.
 */

/** What the player has for the paragraph or audiobook at the reading position. */
export type Info = Omit<ListenInfo, "track"> & { track: (Track & { audioUrl: string }) | null };

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
/** Where this device keeps the speed chosen last (M14 step 6b): every session starts at it. */
export const SPEED_KEY = "nl.playerSpeed";
type Store = Pick<Storage, "getItem" | "setItem">;
const deviceStore = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

/** The speed chosen last on this device, or 1 (also when the browser keeps nothing, as in a private window). */
export function loadSpeed(store: Store | null = deviceStore()): number {
  try {
    const s = Number(store?.getItem(SPEED_KEY));
    return SPEEDS.includes(s) ? s : 1;
  } catch {
    return 1;
  }
}

/** Keeps the speed for the next session on this device; a browser that keeps nothing just forgets it. */
export function saveSpeed(speed: number, store: Store | null = deviceStore()) {
  try {
    store?.setItem(SPEED_KEY, String(speed));
  } catch {
    // Storage refused (a private window, or full): the speed holds for this session only.
  }
}
/** The audiobook's next paragraphs are asked for when this few are left in the part the player has. */
export const ASK_MORE_AT = 40;
/** A part that could not be fetched is asked for again after this long. */
export const ASK_AGAIN_MS = 5000;
/** Waiting for audio shorter than this is not mentioned (Chromium waits briefly on every seek). */
export const LOADING_AFTER_MS = 600;
export const OFFLINE = "Reading aloud needs an internet connection: the audio is not saved for reading offline.";

export const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);

/**
 * The voice a new session starts with: the book's own audiobook when it goes
 * on from near the reading position (or nothing else can read aloud),
 * otherwise the first made-on-demand voice.
 */
export function firstVoice(info: Pick<Info, "voices" | "audiobook">): string {
  const made = info.voices.find((v) => !v.id.startsWith("upload:"));
  const ab = info.audiobook;
  const bookFirst = ab && ab.paragraphs.length && (!ab.begins || ab.begins.nearby || !made);
  return bookFirst ? ab.voice : ((made ?? info.voices[0])?.id ?? "");
}

/** Everything the bar's note depends on. */
export type NoteState = {
  error: string | null;
  info: Info | null;
  /** The chosen voice is the book's own audiobook. */
  isBook: boolean;
  voice: string;
  bookEnded: boolean;
  /** Audio has been waiting to arrive for a while. */
  loading: boolean;
  /** The audiobook has played in this session (the note no longer says where it begins). */
  bookStarted: boolean;
};

/** The line the bar shows under its buttons. */
export function noteFor(s: NoteState): string {
  const { info } = s;
  if (s.error) return s.error;
  if (!info) return "Finding where you are…";
  if (s.isBook) {
    const ab = info.audiobook!;
    if (!ab.paragraphs.length) return "Your audiobook ends before this part of the book.";
    if (s.bookEnded) return "That is the end of your audiobook.";
    if (s.loading) return "Loading your audiobook…";
    if (ab.begins && !ab.begins.nearby && !s.bookStarted) return `Your audiobook begins further on (${ab.begins.label}): Play turns to it.`;
    return "Your audiobook: free to play.";
  }
  if (info.fileType === "pdf") return "In a PDF book, Listen plays your own audiobook: add one on the book's page.";
  if (info.estimate === null) return "Reading aloud is not set up yet: the owner needs to add an ElevenLabs key.";
  if (info.track && info.track.voice === s.voice) return "Saved audio: free to play.";
  return `This paragraph costs ${usd(info.estimate)} to read aloud; then it is saved.`;
}
