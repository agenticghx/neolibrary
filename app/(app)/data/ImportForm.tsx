"use client";

import { useState } from "react";
import forms from "@/components/forms.module.css";

export function ImportForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: await file.text() });
      const json = await res.json();
      setMessage(res.ok ? `Brought back ${json.books} books, ${json.paths} paths and ${json.collections} collections.` : json.error);
    } catch {
      setMessage("The import failed and nothing was changed.");
    } finally {
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
        onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
      />
      {message ? (
        <p role="status" className={forms.error}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
