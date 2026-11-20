import { and, desc, eq, inArray } from "drizzle-orm";
import { bookGroup, capsFromEnv, keptHold, reserveSpend, toGeneration, type Caps, type Generation } from "@/lib/ai/generate";
import { fill, readPrompt, sha256 } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { books, generations } from "@/lib/db/schema";
import { imageUsd, type ImageGenerator } from "@/lib/images/generate";
import type { Storage } from "@/lib/storage";
import { isOwnBook } from "@/lib/library/own-book";

/**
 * Generated pictures (M9): made once for a subject in a book, stored in the
 * bucket, re-served after (ground rule 5), with the cost shown first and the
 * picture caps (IMAGE_CAP_PER_BOOK_USD, IMAGE_CAP_PER_MONTH_USD) applied
 * (ground rule 8). The stored answer's output is the picture's storage key.
 */
export class PictureError extends Error {}

const cleanSubject = (s: unknown) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

async function request(db: Db, ownerId: string, bookId: string, subjectIn: unknown) {
  const subject = cleanSubject(subjectIn);
  if (!subject) throw new PictureError("Say what the picture should show.");
  const [book] = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookId)
    ? await db
        .select({ title: books.title, author: books.author })
        .from(books)
        .where(isOwnBook(bookId, ownerId))
    : [];
  if (!book) throw new PictureError("Book not found.");
  const file = await readPrompt("image");
  const prompt = fill(file.trim(), { subject, book: book.author ? `${book.title} by ${book.author}` : book.title });
  const promptHash = sha256(file);
  const cacheKey = sha256(JSON.stringify(["image", subject.toLowerCase(), promptHash]));
  return { subject, prompt, promptHash, cacheKey };
}

async function findStoredPicture(db: Db, ownerId: string, bookId: string, cacheKey: string): Promise<Generation | null> {
  const [row] = await db
    .select()
    .from(generations)
    // This book's picture only (a scan and its text edition are one book): the prompt names the book, so another
    // book's picture of the same subject is a different one.
    .where(and(eq(generations.ownerId, ownerId), inArray(generations.bookId, await bookGroup(db, bookId)), eq(generations.cacheKey, cacheKey)))
    .orderBy(desc(generations.createdAt))
    .limit(1);
  return row ? toGeneration(row) : null;
}

export async function storedPicture(db: Db, ownerId: string, bookId: string, subject: unknown): Promise<Generation | null> {
  const r = await request(db, ownerId, bookId, subject);
  return findStoredPicture(db, ownerId, bookId, r.cacheKey);
}

export const estimatePicture = () => imageUsd();

const inflightPictures = new Map<string, Promise<{ generation: Generation; reused: boolean }>>();

export async function makePicture(
  db: Db,
  storage: Storage,
  generator: ImageGenerator,
  ownerId: string,
  input: { bookId: string; subject: unknown },
  opts: { caps?: Caps; now?: () => Date } = {},
): Promise<{ generation: Generation; reused: boolean }> {
  const r = await request(db, ownerId, input.bookId, input.subject);
  const stored = await findStoredPicture(db, ownerId, input.bookId, r.cacheKey);
  if (stored) return { generation: stored, reused: true };
  const inflightKey = `${ownerId}|${input.bookId}|${generator.provider}|${r.cacheKey}`;
  const running = inflightPictures.get(inflightKey);
  if (running) return running.then(({ generation }) => ({ generation, reused: true }));
  const job = (async () => {
    const again = await findStoredPicture(db, ownerId, input.bookId, r.cacheKey);
    if (again) return { generation: again, reused: true };
    const now = opts.now?.() ?? new Date();
    const hold = await reserveSpend(
      db,
      generator.provider,
      { ownerId, bookId: input.bookId, model: generator.model, kind: "image" },
      imageUsd(),
      opts.caps ?? capsFromEnv(process.env, "IMAGE"),
      now,
      "image",
    );
    let picture: Awaited<ReturnType<ImageGenerator["generate"]>>;
    try {
      picture = await generator.generate(r.prompt);
    } catch (e) {
      await hold.release().catch(keptHold);
      throw e;
    }
    try {
      const id = crypto.randomUUID();
      const key = `images/${ownerId}/${input.bookId}/${id}.png`;
      await storage.put(key, picture.data, picture.mime);
      const [row] = await db
        .insert(generations)
        .values({
          id,
          ownerId,
          bookId: input.bookId,
          sectionId: null,
          kind: "image",
          options: { subject: r.subject },
          cacheKey: r.cacheKey,
          provider: generator.provider,
          model: generator.model,
          promptName: "image",
          promptHash: r.promptHash,
          inputHash: sha256(r.subject.toLowerCase()),
          costUsd: imageUsd(),
          output: key,
          createdAt: now,
        })
        .returning();
      await hold.release().catch(keptHold);
      return { generation: toGeneration(row), reused: false };
    } catch (e) {
      // Paid, but the picture could not be kept: its cost still counts.
      const reason = `Paid, but the picture could not be saved: ${e instanceof Error ? e.message : String(e)}`;
      await hold.billed({ model: generator.model, costUsd: imageUsd(), reason }).catch(keptHold);
      throw e;
    }
  })();
  inflightPictures.set(inflightKey, job);
  try {
    return await job;
  } finally {
    inflightPictures.delete(inflightKey);
  }
}
