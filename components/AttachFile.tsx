"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ACCEPT } from "@/components/upload/useBookUpload";
import styles from "./AttachFile.module.css";

/**
 * "Choose the book file" on a title not available yet (M14 step 5): the file
 * goes to this title, whatever its own name, and the title takes its colour.
 * It stays on the page after the file arrives, so its message is still there
 * to read, and focus moves to Read.
 */
export function AttachFile({ bookId, hasFile, readLinkId }: { bookId: string; hasFile: boolean; readLinkId: string }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const added = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // The refresh brought the file and the Read link: go there, unless the reader has moved on.
  useEffect(() => {
    if (!hasFile || !added.current) return;
    added.current = false;
    const at = document.activeElement;
    if (!at || at === document.body || box.current?.contains(at)) document.getElementById(readLinkId)?.focus();
  }, [hasFile, readLinkId]);

  async function send(file: File) {
    setBusy(true);
    setMessage("Reading the book…");
    const body = new FormData();
    body.append("files", file);
    body.append("attachTo", bookId);
    try {
      const res = await fetch("/api/books", { method: "POST", body });
      const json = await res.json();
      const r = json.results?.[0];
      if (!res.ok) setMessage(json.error ?? "That did not work.");
      else if (r?.status === "error") setMessage(r.message);
      else {
        added.current = true;
        setMessage(`Added the book file (${file.name}). It is ready to read.`);
        router.refresh();
        return; // stays busy: the refresh replaces the picker with the book
      }
    } catch {
      setMessage("That did not work. Try again.");
    }
    setBusy(false);
  }

  if (hasFile && !message) return null; // a book that already had its file: nothing to draw
  return (
    <div className={styles.attach} ref={box}>
      {hasFile ? null : (
        <label className={styles.pick}>
          Choose the book file
          <input
            type="file"
            accept={ACCEPT}
            className="visually-hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void send(f);
              e.target.value = "";
            }}
          />
        </label>
      )}
      <p role="status" className={styles.message} data-testid="attach-status">
        {message}
      </p>
    </div>
  );
}
