"use client";

import { useEffect, useId, useState } from "react";
import { OWN_KEY_STORAGE, type OwnKeyKind } from "@/lib/own-key-names";
import { ownKey, setOwnKey } from "@/lib/own-keys";
import styles from "./OwnKeysSetting.module.css";

const KINDS: { kind: OwnKeyKind; name: string; for: string; where: string }[] = [
  { kind: "ai", name: "Anthropic key", for: "new AI answers: rewrites, Need to know, Test yourself, Ask, Explain it back, the X-ray", where: "console.anthropic.com" },
  { kind: "voice", name: "ElevenLabs key", for: "an AI voice reading aloud, and transcripts of voice notes", where: "elevenlabs.io" },
];

/** The last four characters only: enough to tell two keys apart, never the key. */
const tail = (key: string) => `…${key.slice(-4)}`;

/**
 * M34 S4: your own keys. The library's owner pays only for their own use, so anyone else who wants new AI answers
 * or an AI voice adds their own key here. It is kept in this browser only (localStorage), never on the server, and
 * sent only with the requests that use it. Answers already saved stay free to read.
 */
export function OwnKeysSetting({ heading = "Your own keys" }: { heading?: string }) {
  const [saved, setSaved] = useState<Record<OwnKeyKind, string | null>>({ ai: null, voice: null });
  const [draft, setDraft] = useState<Record<OwnKeyKind, string>>({ ai: "", voice: "" });
  const [note, setNote] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    const read = () => setSaved({ ai: ownKey("ai"), voice: ownKey("voice") });
    read();
    // Another tab added or removed a key.
    const onStorage = (e: StorageEvent) => {
      if (e.key === OWN_KEY_STORAGE.ai || e.key === OWN_KEY_STORAGE.voice) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const keep = (kind: OwnKeyKind, value: string | null) => {
    const kept = setOwnKey(kind, value);
    setSaved((s) => ({ ...s, [kind]: kept ? ownKey(kind) : null }));
    setDraft((d) => ({ ...d, [kind]: "" }));
    setNote(value && !kept ? "This browser does not allow saving (a private window?). The key was not kept." : null);
  };

  return (
    <fieldset className={styles.group} data-testid="own-keys">
      <legend>{heading}</legend>
      <p className={styles.hint}>
        New AI answers and AI voices are paid with your own key. It stays in this browser only, is sent only with the
        request that uses it, and is never saved on the server. Answers already saved are free to read.
      </p>
      {KINDS.map((k) => (
        <div key={k.kind} className={styles.row}>
          {saved[k.kind] ? (
            <>
              <p className={styles.saved}>
                <strong>{k.name}</strong> {tail(saved[k.kind]!)} · kept in this browser
              </p>
              <button type="button" className={styles.button} onClick={() => keep(k.kind, null)}>
                Remove {k.name}
              </button>
            </>
          ) : (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                if (draft[k.kind].trim()) keep(k.kind, draft[k.kind]);
              }}
            >
              <label htmlFor={`${id}-${k.kind}`} className={styles.label}>
                {k.name} <span className={styles.for}>for {k.for} (from {k.where})</span>
              </label>
              <span className={styles.inputRow}>
                <input
                  id={`${id}-${k.kind}`}
                  className={styles.input}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft[k.kind]}
                  onChange={(e) => setDraft((d) => ({ ...d, [k.kind]: e.target.value }))}
                />
                <button type="submit" className={styles.button} disabled={!draft[k.kind].trim()}>
                  Save
                </button>
              </span>
            </form>
          )}
        </div>
      ))}
      {note ? (
        <p className={styles.hint} role="alert">
          {note}
        </p>
      ) : null}
    </fieldset>
  );
}
