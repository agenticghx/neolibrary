import { DriveError, parseDriveLink, type DriveSource } from "@/lib/drive";
import type { Db } from "@/lib/db/client";
import type { Storage } from "@/lib/storage";
import { ImportError, MAX_BOOK_BYTES } from "./ebook";
import { importBook, type ImportResult } from "./import";

export type DriveOutcome = { file: string } & (ImportResult | { status: "error"; message: string });

/** At most this many books from one folder at a time (each up to 200 MB). */
export const MAX_FOLDER_FILES = 25;

const BOOK_FILE = /\.(epub|pdf|md|markdown)$/i;

/**
 * Adds the books behind a Google Drive link (M30): a shared file, or each EPUB, PDF or Markdown file directly in a
 * shared folder (not its subfolders), as if each were uploaded on the Import page (lib/library/import.ts), so a book
 * matching a waiting title attaches to it. Other files in a folder are listed as skipped. `attachTo` (one file only)
 * puts the file on that title, as "Choose the book file" does.
 */
export async function importFromDrive(
  ctx: { db: Db; storage: Storage; drive: DriveSource },
  ownerId: string,
  link: unknown,
  opts: { attachTo?: string | null } = {},
): Promise<DriveOutcome[]> {
  const parsed = typeof link === "string" ? parseDriveLink(link) : null;
  if (!parsed) throw new ImportError("Paste a Google Drive link to a book file or a folder (https://drive.google.com/…).");
  if (parsed.kind === "folder" && opts.attachTo) throw new ImportError("Choose one file for a title, not a folder.");
  let files: { id: string; name: string | null }[];
  const skipped: DriveOutcome[] = [];
  try {
    if (parsed.kind === "file") files = [{ id: parsed.id, name: null }];
    else {
      const all = await ctx.drive.list(parsed.id);
      const books = all.filter((f) => BOOK_FILE.test(f.name));
      for (const f of all) if (!BOOK_FILE.test(f.name)) skipped.push({ file: f.name, status: "error", message: "Skipped: not an EPUB, PDF or Markdown file." });
      if (!books.length) throw new ImportError(all.length ? "This folder has no EPUB, PDF or Markdown files." : "This folder is empty, or not shared as “Anyone with the link”.");
      if (books.length > MAX_FOLDER_FILES) throw new ImportError(`This folder has ${books.length} book files; add at most ${MAX_FOLDER_FILES} at a time (make a smaller folder).`);
      files = books;
    }
  } catch (e) {
    if (e instanceof DriveError) throw new ImportError(e.message);
    throw e;
  }
  const out: DriveOutcome[] = [];
  for (const f of files) {
    try {
      const got = await ctx.drive.download(f.id, MAX_BOOK_BYTES);
      if (!BOOK_FILE.test(got.name)) {
        out.push({ file: got.name, status: "error", message: "Only EPUB, PDF and Markdown (.md) files can be added." });
        continue;
      }
      out.push({ file: got.name, ...(await importBook(ctx.db, ctx.storage, ownerId, got, { attachTo: opts.attachTo ?? null })) });
    } catch (e) {
      if (!(e instanceof DriveError || e instanceof ImportError)) throw e;
      out.push({ file: f.name ?? "Google Drive file", status: "error", message: e.message });
    }
  }
  return [...out, ...skipped];
}
