"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { UploadOutcome } from "@/app/api/books/route";
import { markdownIn, ZIP_NOT_A_BOOK, zipNames } from "@/lib/library/zip-names";

/** What each upload outcome says to the reader. */
export const UPLOAD_MESSAGES = {
  added: "Added to your library",
  attached: "Added to a title that was waiting for it",
  duplicate: "Already in your library",
  restored: "You had removed this book: it is back, with your notes",
} as const;

export const ACCEPT = ".epub,.pdf,.md,.markdown,.zip,application/epub+zip,application/pdf,text/markdown,application/zip";

/**
 * Sends EPUB, PDF and Markdown files to /api/books, one request per file, and refreshes
 * the page so the new books show. Used by the Import page (M14 follow-up V3a),
 * which accepts drops anywhere on the page.
 */
export function useBookUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadOutcome[]>([]);
  // How many files the server read (a .zip refused here is not one of them).
  const [read, setRead] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | File[]) {
    const all = [...files];
    if (!all.length) return;
    // A .zip is a book only when it holds a Markdown file (a paper and its pictures, M41 R2). Any other .zip is most
    // likely a read-along package (your own audiobook), often hundreds of MB: a drop anywhere on the Import page lands
    // here, even on the audiobook section. Only the zip's table of contents is read to tell; the other is not sent.
    const isZip = (f: File) => /\.zip$/i.test(f.name);
    const paperZip = new Set<File>();
    for (const f of all.filter(isZip)) if (markdownIn((await zipNames(f).catch(() => null)) ?? []).length) paperZip.add(f);
    const refused: UploadOutcome[] = all.filter((f) => isZip(f) && !paperZip.has(f)).map((f) => ({ file: f.name, status: "error", message: ZIP_NOT_A_BOOK }));
    const list = all.filter((f) => !isZip(f) || paperZip.has(f));
    setError(null);
    if (!list.length) {
      setResults(refused);
      setRead(0);
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true);
    // One request per file. The server holds a request only up to one book's
    // limit (200 MB); a drop of several books must not become one body that
    // large. See docs/security-leftovers.md (B2).
    const outcomes: UploadOutcome[] = [];
    try {
      for (const f of list) {
        const body = new FormData();
        body.append("files", f);
        try {
          const res = await fetch("/api/books", { method: "POST", body });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) outcomes.push({ file: f.name, status: "error", message: json.error ?? "Upload failed." });
          else outcomes.push(...(json.results ?? []));
        } catch {
          outcomes.push({ file: f.name, status: "error", message: "Upload failed." });
        }
      }
      setResults([...outcomes, ...refused]);
      setRead(outcomes.length);
      if (outcomes.some((o) => o.status !== "error")) router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  /** M30: the books behind a Google Drive link (a shared file or folder), read by the server. */
  async function fromDrive(link: string) {
    if (!link.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/books/drive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ link }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResults([]);
        setRead(0);
        setError(json.error ?? "That Google Drive link could not be read.");
        return false;
      }
      const outcomes: UploadOutcome[] = json.results ?? [];
      setResults(outcomes);
      setRead(outcomes.length);
      if (outcomes.some((o) => o.status !== "error")) router.refresh();
      return true;
    } catch {
      setError("That Google Drive link could not be read. Check the connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { input, busy, results, read, error, upload, fromDrive };
}
