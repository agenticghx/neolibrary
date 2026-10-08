import { and, desc, eq } from "drizzle-orm";
import { capsFromEnv, reserveSpend, toGeneration, type Caps, type Generation } from "@/lib/ai/generate";
import { fill, readPrompt, sha256 } from "@/lib/ai/prompts";
import type { Db } from "@/lib/db/client";
import { books, generations } from "@/lib/db/schema";
import { imageUsd, type ImageGenerator } from "@/lib/images/generate";
import type { Storage } from "@/lib/storage";

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
  const [book] = /^[0-9a-f-]{36}$/i.test(bookId)
    ? await db
        .select({ title: books.title, author: books.author })
        .from(books)
        .where(and(eq(books.id, bookId), eq(books.ownerId, ownerId)))
    : [];
  if (!book) throw new PictureError("Book not found.");
  const file = await readPrompt("image");
  const prompt = fill(file.trim(), { subject, book: book.author ? `${book.title} by ${book.author}` : book.title });
  const promptHash = sha256(file);
  const cacheKey = sha256(JSON.stringify(["image", subject.toLowerCase(), promptHash]));
  return { subject, prompt, promptHash, cacheKey };
}

export async function storedPicture(db: Db, ownerId: string, bookId: string, subject: unknown): Promise<Generation | null> {
  const r = await request(db, ownerId, bookId, subject);
  const [row] = await db
    .select()
    .from(generations)
    .where(and(eq(generations.ownerId, ownerId), eq(generations.cacheKey, r.cacheKey)))
    .orderBy(desc(generations.createdAt))
    .limit(1);
  return row ? toGeneration(row) : null;
}

export const estimatePicture = () => imageUsd();

export async function makePicture(
  db: Db,
  storage: Storage,
  generator: ImageGenerator,
  ownerId: string,
  input: { bookId: string; subject: unknown },
  opts: { caps?: Caps; now?: () => Date } = {},
): Promise<{ generation: Generation; reused: boolean }> {
  const r = await request(db, ownerId, input.bookId, input.subject);
  const stored = await storedPicture(db, ownerId, input.bookId, r.subject);
  if (stored) return { generation: stored, reused: true };
  const now = opts.now?.() ?? new Date();
  const release = await reserveSpend(db, generator.provider, input.bookId, imageUsd(), opts.caps ?? capsFromEnv(process.env, "IMAGE"), now, "image");
  try {
    const picture = await generator.generate(r.prompt);
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
    return { generation: toGeneration(row), reused: false };
  } finally {
    await release();
  }
}
