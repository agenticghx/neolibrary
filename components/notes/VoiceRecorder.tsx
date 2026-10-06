"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./VoiceRecorder.module.css";

const MAX_MS = 10 * 60 * 1000;
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/**
 * Records a voice note in the browser (M8): Record, Stop, then Save or
 * Discard. Uses the microphone through MediaRecorder; nothing leaves the
 * device until Save.
 */
export function VoiceRecorder({ onSave, onBack }: { onSave: (audio: Blob, durationMs: number) => Promise<void>; onBack: () => void }) {
  const [state, setState] = useState<"idle" | "recording" | "done" | "saving">("idle");
  const [ms, setMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const result = useRef<{ blob: Blob; ms: number } | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (tick.current) clearInterval(tick.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const stop = () => {
    if (tick.current) clearInterval(tick.current);
    recorder.current?.stop();
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const length = Date.now() - started.current;
        result.current = { blob: new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }), ms: length };
        setMs(length);
        setState("done");
      };
      recorder.current = rec;
      started.current = Date.now();
      rec.start(250);
      setState("recording");
      tick.current = setInterval(() => {
        const t = Date.now() - started.current;
        setMs(t);
        if (t >= MAX_MS) stop();
      }, 200);
    } catch {
      setError("The microphone is not available. Allow it in the browser and try again.");
    }
  };

  return (
    <div className={styles.recorder} role="group" aria-label="Voice note">
      <p className={styles.recorderState} aria-live="polite">
        {state === "idle" ? "Say what you are thinking. Up to 10 minutes." : null}
        {state === "recording" ? (
          <>
            <span className={styles.recDot} aria-hidden="true" /> Recording {clock(ms)}
          </>
        ) : null}
        {state === "done" ? `Recorded ${clock(ms)}. Save it, or discard and try again.` : null}
        {state === "saving" ? "Saving and transcribing…" : null}
      </p>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.noteActions}>
        <button type="button" className={styles.tool} disabled={state === "recording" || state === "saving"} onClick={onBack}>
          Back
        </button>
        {state === "idle" ? (
          <button type="button" className={styles.primaryTool} onClick={() => void start()}>
            Record
          </button>
        ) : null}
        {state === "recording" ? (
          <button type="button" className={styles.primaryTool} onClick={stop}>
            Stop
          </button>
        ) : null}
        {state === "done" ? (
          <>
            <button
              type="button"
              className={styles.tool}
              onClick={() => {
                result.current = null;
                setMs(0);
                setState("idle");
              }}
            >
              Discard
            </button>
            <button
              type="button"
              className={styles.primaryTool}
              onClick={async () => {
                if (!result.current) return;
                setState("saving");
                try {
                  await onSave(result.current.blob, result.current.ms);
                } catch (e) {
                  setError((e as Error).message);
                  setState("done");
                }
              }}
            >
              Save voice note
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
