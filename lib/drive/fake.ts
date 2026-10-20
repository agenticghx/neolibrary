import { readableEpub } from "@/lib/library/test-epub";
import { DriveError, type DriveFile, type DriveSource } from "./drive";

/**
 * Google Drive for tests (DRIVE_FAKE=1 in the browser tests, and the unit tests): a shared folder and its files,
 * made-up books, nothing fetched. Ids are shaped like Drive's.
 */
export const FAKE_DRIVE = {
  folder: "1FakeDriveFolderForTests00",
  book: "1FakeDriveBookEpubForTests0",
  notes: "1FakeDriveNotesTxtForTests0",
  markdown: "1FakeDriveMarkdownForTests0",
  private: "1FakeDrivePrivateForTests00",
} as const;

const FILES: Record<string, { name: string; bytes: () => Uint8Array }> = {
  [FAKE_DRIVE.book]: {
    name: "a-drive-book.epub",
    bytes: () => readableEpub("A Book From Drive", ["<h1>The Shelf</h1><p>A book kept in a shared folder, read here like any other.</p>"], "Dee Rive"),
  },
  [FAKE_DRIVE.notes]: { name: "shopping-list.txt", bytes: () => new TextEncoder().encode("milk, eggs") },
  [FAKE_DRIVE.markdown]: { name: "drive-notes.md", bytes: () => new TextEncoder().encode("# Drive Notes\n\nA short book written in Markdown and kept on Drive.") },
};

export class FakeDrive implements DriveSource {
  async list(folderId: string): Promise<DriveFile[]> {
    if (folderId !== FAKE_DRIVE.folder) throw new DriveError("Google Drive did not send this. Share it as “Anyone with the link” (Share → General access), then try again.");
    return [FAKE_DRIVE.book, FAKE_DRIVE.notes, FAKE_DRIVE.markdown].map((id) => ({ id, name: FILES[id].name }));
  }

  async download(fileId: string, maxBytes: number) {
    const f = FILES[fileId];
    if (!f) throw new DriveError("Google Drive did not send this. Share it as “Anyone with the link” (Share → General access), then try again.");
    const bytes = f.bytes();
    if (bytes.byteLength > maxBytes) throw new DriveError("This file is too large.");
    return { name: f.name, bytes };
  }
}
