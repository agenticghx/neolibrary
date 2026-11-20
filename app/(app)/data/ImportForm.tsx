"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import forms from "@/components/forms.module.css";

export function ImportForm() {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File, input: HTMLInputElement) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: await file.text() });
      const json = (await res.json().catch(() => ({}))) as { books?: number; paths?: number; collections?: number; error?: string };
      setMessage(
        res.ok
          ? { text: `Brought back ${json.books} books, ${json.paths} paths and ${json.collections} collections.`, error: false }
          : { text: json.error ?? "The import failed and nothing was changed.", error: true },
      );
      // The sidebar lists Paths and collections: show the imported ones without a reload.
      if (res.ok) router.refresh();
    } catch {
      setMessage({ text: "The import failed and nothing was changed.", error: true });
    } finally {
      input.value = "";
      setBusy(false);
    }
  }

  return (
    <div className={forms.form}>
      <label className={forms.label} htmlFor="import-file">
        Library file (.json)
      </label>
      <input
        id="import-file"
        type="file"
        accept="application/json,.json"
        className={forms.input}
        disabled={busy}
        onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0], e.currentTarget)}
      />
      {message ? (
        <p role={message.error ? "alert" : "status"} className={forms.error}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
