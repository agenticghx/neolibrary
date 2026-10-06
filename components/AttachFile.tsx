"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACCEPT } from "@/components/upload/useBookUpload";
import styles from "./AttachFile.module.css";

/**
 * "Add the book file" on a title not available yet (M14 step 5): the file
 * goes to this title, whatever its own name, and the title takes its colour.
 */
export function AttachFile({ bookId }: { bookId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
        setMessage("Added. The title is available now.");
        router.refresh();
      }
    } catch {
      setMessage("That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.attach}>
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
      <p role="status" className={styles.message}>
        {message}
      </p>
    </div>
  );
}
