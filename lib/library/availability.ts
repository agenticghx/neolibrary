import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { readalongImports } from "@/lib/db/schema";
import { getSpeechModel } from "@/lib/speech";
import { SpeechNotConfigured, type SpeechModel } from "@/lib/speech/model";

/**
 * What a title offers (M14, D1). Every title in the library is the reader's;
 * it is labelled by what can be done with it (Samuel's rule, docs/plan.md,
 * "The library comes first").
 * - read: it has a book file (EPUB or PDF).
 * - listen: it has an uploaded audiobook that finished uploading, or it is an
 *   EPUB and narration (ElevenLabs, made on demand) is switched on. Narration
 *   is EPUB only: its word times cannot be placed on a PDF page yet.
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
  book: { fileKey: string | null; fileType: "epub" | "pdf" | null },
  hasAudiobook: boolean,
  narration: boolean,
): Availability {
  const read = book.fileKey !== null;
  return { read, listen: hasAudiobook || (read && book.fileType === "epub" && narration) };
}

/** Whether narration is switched on: the fake voice in tests, ElevenLabs with a key, otherwise off. */
export function narrationOn(speech: () => SpeechModel = getSpeechModel): boolean {
  try {
    speech();
    return true;
  } catch (e) {
    if (e instanceof SpeechNotConfigured) return false;
    throw e;
  }
}

/** Of `bookIds`, the ones with an uploaded audiobook that finished uploading (one query). */
export async function audiobookBookIds(db: Db, ownerId: string, bookIds: string[]): Promise<Set<string>> {
  if (!bookIds.length) return new Set();
  const rows = await db
    .selectDistinct({ bookId: readalongImports.bookId })
    .from(readalongImports)
    .where(
      and(
        eq(readalongImports.ownerId, ownerId),
        eq(readalongImports.status, "ready"),
        inArray(readalongImports.bookId, [...new Set(bookIds)]),
      ),
    );
  return new Set(rows.map((r) => r.bookId));
}
