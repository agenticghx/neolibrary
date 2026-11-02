import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { appSettings, books, sections } from "@/lib/db/schema";
import type { Storage } from "@/lib/storage";
import { extractSections, type SectionForm } from "./sections";

/** The app_settings row that says the pass below has run. */
export const SECTION_FORMS = "section-forms";

/**
 * M41 R1c: labels the paragraphs of EPUBs already in the library with their form (equation, table cell), once, at
 * start-up. New books get their forms when their sections are built; until this pass reaches a book, its paragraphs
 * stay prose, which is how every paragraph was treated before, so a pass cut short changes nothing for the worse.
 * Paragraph ids come from the file's content, so the same file gives the same ids: forms are matched to rows by id,
 * and no note's anchor moves. Returns null when the pass ran before.
 */
export async function backfillSectionForms(db: Db, storage: Storage): Promise<{ books: number; labelled: number } | null> {
  const [done] = await db.select({ name: appSettings.name }).from(appSettings).where(eq(appSettings.name, SECTION_FORMS));
  if (done) return null;
  const list = await db
    .select({ id: books.id, fileKey: books.fileKey, toc: books.toc })
    .from(books)
    .where(and(eq(books.fileType, "epub"), isNotNull(books.fileKey)));
  let touched = 0;
  let labelled = 0;
  for (const b of list) {
    try {
      const file = await storage.get(b.fileKey!);
      if (!file) continue;
      const byForm = new Map<SectionForm, string[]>();
      for (const s of extractSections(file.data, (b.toc ?? []) as { label: string; href: string }[])) {
        if (s.kind === "paragraph" && s.form && s.form !== "prose") byForm.set(s.form, [...(byForm.get(s.form) ?? []), s.id]);
      }
      if (!byForm.size) continue;
      for (const [form, ids] of byForm) {
        for (let i = 0; i < ids.length; i += 500) {
          const rows = await db
            .update(sections)
            .set({ form })
            .where(and(eq(sections.bookId, b.id), inArray(sections.id, ids.slice(i, i + 500))))
            .returning({ id: sections.id });
          labelled += rows.length;
        }
      }
      touched += 1;
    } catch (e) {
      console.error("Section forms: skipped a book", b.id, e);
    }
  }
  const value = { books: String(touched), labelled: String(labelled), at: new Date().toISOString() };
  await db.insert(appSettings).values({ name: SECTION_FORMS, value }).onConflictDoNothing();
  return { books: touched, labelled };
}
