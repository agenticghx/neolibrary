import type { EarlierPart, ReadingPart, Track } from "@/lib/library/audio";
import type { ListenInfo } from "@/lib/library/listen";

/**
 * The read-aloud player's rules that need no browser (M14 step 6a): which
 * voice a new session starts with, and what the bar says. The player itself
 * is components/player/ListenSession.tsx; where the audiobook is in the book
 * is lib/readalong/player.ts.
 */

/** What the player has for the paragraph or audiobook at the reading position. */
export type Info = Omit<ListenInfo, "track"> & { track: (Track & { audioUrl: string }) | null };

/**
 * An audiobook's reading with the next part fetched added on (M14 step 6b):
 * its paragraphs, where the part after it starts, and the names of the
 * chapters of every part so far (the mini-player shows the chapter being read).
 */
export function withPart<T extends ReadingPart>(reading: T, part: ReadingPart): T {
  return { ...reading, paragraphs: [...reading.paragraphs, ...part.paragraphs], more: part.more, chapters: { ...reading.chapters, ...part.chapters } };
}

/**
 * An audiobook's reading with the part before it added at the front (going
 * back from where the reading began): its paragraphs first, where the part
 * before them ends, and the names of their chapters too. Every index into
 * `paragraphs` moves on by the number added.
 */
export function withEarlier<T extends ReadingPart & { earlier: number | null }>(reading: T, part: EarlierPart): T {
  return { ...reading, paragraphs: [...part.paragraphs, ...reading.paragraphs], earlier: part.earlier, chapters: { ...part.chapters, ...reading.chapters } };
}

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
/**
 * How long a back skip waits for the part of the audiobook before the paragraphs loaded (Back and Forward wait
 * with it). By estimate, a part (200 paragraphs, about 8,000 words of timings, compressed) takes about 2 s on a
 * slow phone network; past this, the request is given up and the skip lands within what is loaded, counted
 * from where the audio is by then.
 */
export const LOOK_BACK_MS = 8000;
/** Waiting for audio shorter than this is not mentioned (Chromium waits briefly on every seek). */
export const LOADING_AFTER_MS = 600;
export const OFFLINE = "Reading aloud needs an internet connection: the audio is not saved for reading offline.";

export const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);

/**
 * Samuel (2026-10-09, choice "both"): a made voice reading on by itself pays
 * for each new paragraph, so it stops and asks "Keep reading?" once this much
 * has been paid since Play or the last "Keep reading", before it pays for the
 * next one. Saved audio, the book's own audiobook, and a skip the reader taps
 * never ask.
 */
export const ASK_AGAIN_USD = 1;

/** What has been paid for in this listen (one opening of Listen): paragraphs made, and their cost. */
export type Made = { count: number; usd: number };
export const NOTHING_MADE: Made = { count: 0, usd: 0 };

/** Whether reading on into a paragraph with no saved audio must ask first: `sinceOk` paid since Play or the last "Keep reading". */
export const mustAsk = (sinceOkUsd: number) => sinceOkUsd >= ASK_AGAIN_USD;

/** The running total the bar adds to its line: " This listen: 3 paragraphs made, about $2.55." (nothing when none). */
export const madeSoFar = (made: Made) =>
  made.count ? ` This listen: ${made.count} ${made.count === 1 ? "paragraph" : "paragraphs"} made, ${usd(made.usd)}.` : "";

/**
 * The voice a new session starts with: the book's own audiobook when it goes
 * on from near the reading position (or nothing else can read aloud);
 * otherwise the voice this paragraph's audio is saved in, so it plays for
 * free (a book narrated whole on the Import page in a voice that is not the
 * first on offer: review of #100); otherwise the first made-on-demand voice.
 */
export function firstVoice(info: Pick<Info, "voices" | "audiobook" | "track">): string {
  const made = info.voices.find((v) => !v.id.startsWith("upload:"));
  const ab = info.audiobook;
  const bookFirst = ab && ab.paragraphs.length && (!ab.begins || ab.begins.nearby || !made);
  if (bookFirst) return ab.voice;
  const saved = info.track ? info.voices.find((v) => v.id === info.track!.voice && !v.id.startsWith("upload:")) : undefined;
  return (saved ?? made ?? info.voices[0])?.id ?? "";
}

/**
 * Whether Home's "Listen from here" may play the book's own audiobook in one
 * tap (M14 step 6b): only when it has something to play from the reading
 * position on, and goes on from near it. Otherwise the reader opens, and its
 * bar says why (the audiobook ends before here, or begins further on) and
 * waits for Play.
 */
export function playsHere(info: Pick<Info, "audiobook"> | null): boolean {
  const ab = info?.audiobook;
  return !!ab && ab.paragraphs.length > 0 && (!ab.begins || ab.begins.nearby);
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
  /** Paid for in this listen (a made voice). */
  made?: Made;
  /** Reading on stopped to ask first: what the next paragraph costs. */
  ask?: number | null;
  /** The paragraph shown was paid for just now, in this listen. */
  justMade?: boolean;
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
  const made = madeSoFar(s.made ?? NOTHING_MADE);
  if (s.ask != null) return `Keep reading? The next paragraph costs ${usd(s.ask)}.${made}`;
  if (info.estimate === null) return "Reading aloud is not set up yet: the owner needs to add an ElevenLabs key.";
  if (info.track && info.track.voice === s.voice) return `${s.justMade ? "Made just now; it plays free from now on." : "Saved audio: free to play."}${made}`;
  return `This paragraph costs ${usd(info.estimate)} to read aloud; then it is saved.${made}`;
}

/** "Chapter V" as the mini-player says it: "Ch. V". A chapter with a title keeps it. */
export const shortChapter = (label: string) => label.trim().replace(/^chapter\s+/i, "Ch. ");

/** A speed as the player shows it: "1.0×", "1.25×", "2.0×". */
export const speedLabel = (speed: number) => `${Number.isInteger(speed) ? speed.toFixed(1) : speed}×`;
