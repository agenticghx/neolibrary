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

  // The places that still write "this book, of this reader" by hand, how many times each, and why. A new place, or
  // one more in a listed file, fails here: use isOwnBook, or add the place to this list and say why.
  const BY_HAND: Record<string, number> = {
    // A note made for a book that was removed meanwhile (on another device, or while offline) is still saved, and
    // comes back with the book: notes are never lost (ground rule 9).
    "lib/library/annotations.ts": 1,
    "lib/library/voice-notes.ts": 1,
    // Reading time already spent on a book counts, whether or not the book was removed since.
    "lib/library/reading-stats.ts": 1,
    // A text edition's scan follows its progress; the edition itself is checked with isOwnBook on the line before.
    "lib/library/reading.ts": 1,
    // Bringing a removed book back must find removed books.
    "lib/library/remove-book.ts": 2,
    // Sharing can be withdrawn whatever state the paper is in; its own condition is "not a copy".
    "lib/library/shared-papers.ts": 1,
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
