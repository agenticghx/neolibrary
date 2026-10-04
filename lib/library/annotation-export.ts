import type { Db } from "@/lib/db/client";
import { toMarkdown, toW3C } from "./annotation-formats";
import { listAnnotations, type Annotation } from "./annotations";
import { getBook } from "./paths";
import { getSections } from "./sections-store";

/** A book's annotations as Markdown or W3C JSON, for its owner. */
export async function exportBookAnnotations(db: Db, ownerId: string, bookId: string, format: "md" | "w3c") {
  const found = await getBook(db, ownerId, bookId);
  if (!found) return null;
  const book = { id: found.book.id, title: found.book.title, author: found.book.author };
  const items = await listAnnotations(db, ownerId, bookId);
  if (format === "w3c") return { book, body: JSON.stringify(toW3C(book, items), null, 2), type: "application/ld+json", ext: "json" };
  const secs = await getSections(db, ownerId, bookId);
  const chapterByIndex = new Map(secs.filter((s) => s.kind === "chapter").map((s) => [s.chapterIndex, s.label]));
  const indexById = new Map(secs.map((s) => [s.id, s.chapterIndex]));
  const chapterOf = (a: Annotation) => (a.sectionId ? chapterByIndex.get(indexById.get(a.sectionId) ?? -1) ?? "" : "");
  return { book, body: toMarkdown(book, items, chapterOf), type: "text/markdown; charset=utf-8", ext: "md" };
}

export function fileSlug(title: string) {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "book"
  );
}
