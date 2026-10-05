import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { readalongImports } from "@/lib/db/schema";
import { getSpeechModel } from "@/lib/speech";
import { SpeechNotConfigured, type SpeechModel } from "@/lib/speech/model";

/**
 * The server-side facts behind a title's availability (./availability.ts):
 * whether narration is on, and which books have an uploaded audiobook.
 */

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
