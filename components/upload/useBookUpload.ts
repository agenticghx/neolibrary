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

/**
 * Sends EPUB and PDF files to /api/books (several at once) and refreshes the
 * page so the new books show. Used by the library's drop zone and by Home,
 * which accepts drops anywhere on the page.
 */
export function useBookUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    setError(null);
    const body = new FormData();
    for (const f of list) body.append("files", f);
    try {
      const res = await fetch("/api/books", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed.");
      setResults(json.results);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return { input, busy, results, error, upload };
}
