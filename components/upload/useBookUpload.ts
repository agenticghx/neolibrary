"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { UploadOutcome } from "@/app/api/books/route";

/** What each upload outcome says to the reader. */
export const UPLOAD_MESSAGES = {
  added: "Added to your library",
  attached: "Added to a title that was waiting for it",
  duplicate: "Already in your library",
} as const;

export const ACCEPT = ".epub,.pdf,application/epub+zip,application/pdf";

/** What a .zip dropped on the Import page is told: it is your own audiobook's package, which goes with a book. */
export const ZIP_NOT_A_BOOK =
  "A .zip is not a book. If it is your own audiobook, choose its book under “Add your audiobook to a book”, then choose the .zip there.";

/**
 * Sends EPUB and PDF files to /api/books (several at once) and refreshes the
 * page so the new books show. Used by the Import page (M14 follow-up V3a),
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
    // A .zip is a read-along package (your own audiobook), not a book: a drop
    // anywhere on the Import page lands here, even on the audiobook section,
    // and the server would call the .zip a broken EPUB. Say where it goes.
    const isZip = (f: File) => /\.zip$/i.test(f.name);
    const refused: UploadOutcome[] = all.filter(isZip).map((f) => ({ file: f.name, status: "error", message: ZIP_NOT_A_BOOK }));
    const list = all.filter((f) => !isZip(f));
    setError(null);
    if (!list.length) {
      setResults(refused);
      setRead(0);
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true);
    const body = new FormData();
    for (const f of list) body.append("files", f);
    try {
      const res = await fetch("/api/books", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed.");
      setResults([...json.results, ...refused]);
      setRead(json.results.length);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      if (refused.length) {
        setResults(refused);
        setRead(0);
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return { input, busy, results, read, error, upload };
}
