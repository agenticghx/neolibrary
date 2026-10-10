/**
 * What a title offers (M14, D1). Every title in the library is the reader's;
 * it is labelled by what can be done with it (Samuel's rule, docs/plan.md,
 * "The library comes first").
 * - read: it has a book file (EPUB or PDF).
 * - listen: it has an uploaded audiobook that finished uploading, or it has a
 *   book file and narration (ElevenLabs, made on demand) is switched on. In a
 *   PDF too: since #126 a made paragraph's words are lit on the PDF page
 *   (docs/pdf-narration-plan.md, Parts A and A2).
 * Pure, so a browser-side part can import it; the lookups that need the
 * database or the voice service are in ./listenable.ts.
 */
export type Availability = { read: boolean; listen: boolean };

/** A title with nothing to read or listen to yet (a placeholder on a Path). */
export const NOT_YET: Availability = { read: false, listen: false };

export type AvailabilityLabel = "Read and listen" | "Read only" | "Listen only" | "Not available yet";

export function availabilityLabel(a: Availability): AvailabilityLabel {
  if (a.read && a.listen) return "Read and listen";
  if (a.read) return "Read only";
  if (a.listen) return "Listen only";
  return "Not available yet";
}

/** True when the title has anything at all: its cover takes its colour. */
export const isAvailable = (a: Availability) => a.read || a.listen;

export function availabilityOf(
  book: { fileKey: string | null },
  hasAudiobook: boolean,
  narration: boolean,
): Availability {
  const read = book.fileKey !== null;
  return { read, listen: hasAudiobook || (read && narration) };
}
