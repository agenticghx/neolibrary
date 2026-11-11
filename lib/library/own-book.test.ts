import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { books } from "@/lib/db/schema";
import { isOwnBook } from "./own-book";

const query = (condition: ReturnType<typeof and>) => new PgDialect().sqlToQuery(condition!);

/** Every .ts and .tsx file under a folder that is not a test. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("isOwnBook", () => {
  it("is this book, of this reader, and not removed: the same SQL as the three conditions written by hand", () => {
    const byHand = and(eq(books.id, "book-1"), eq(books.ownerId, "reader-1"), isNull(books.deletedAt));
    expect(query(isOwnBook("book-1", "reader-1"))).toEqual(query(byHand));
    expect(query(isOwnBook("book-1", "reader-1")).sql).toContain('"deleted_at" is null');
  });

  // The places that still write "this book, of this reader" by hand, and how many times each. Some must also find
  // removed books (restoring one); some add their own third condition; the rest are to be judged one by one. A new
  // place, or one more in a listed file, fails here: use isOwnBook, or add the place to this list and say why.
  const BY_HAND: Record<string, number> = {
    "app/(reader)/books/[id]/read/page.tsx": 1,
    "lib/library/ai-style.ts": 3,
    "lib/library/annotations.ts": 1,
    "lib/library/cover-lookup.ts": 1,
    "lib/library/papers.ts": 1,
    "lib/library/reading-stats.ts": 1,
    "lib/library/reading.ts": 2,
    "lib/library/remove-book.ts": 2,
    "lib/library/shared-papers.ts": 1,
    "lib/library/shelf.ts": 1,
    "lib/library/text-edition.ts": 2,
    "lib/library/voice-notes.ts": 1,
    "lib/readalong/importer.ts": 1,
  };

  it("no new place looks up one book for its owner by hand", () => {
    const byHand = /eq\(books\.id, [\w.]+\),\s*eq\(books\.ownerId, [\w.]+\)/g;
    const found: Record<string, number> = {};
    for (const file of [...sources("lib"), ...sources("app")]) {
      if (file === join("lib", "library", "own-book.ts")) continue;
      const count = readFileSync(file, "utf8").match(byHand)?.length ?? 0;
      if (count) found[file.split("\\").join("/")] = count;
    }
    expect(found).toEqual(BY_HAND);
  });
});
