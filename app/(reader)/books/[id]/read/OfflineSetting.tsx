"use client";

import { useEffect, useState } from "react";
import { downloadForOffline, isDownloaded, offlineSupported, removeDownload } from "@/lib/offline";
import styles from "./reader.module.css";

type State = "checking" | "online-only" | "working" | "downloaded" | "unsupported";

/** "Download for offline" (M12): keeps this book, its notes and the reader on this device. */
export function OfflineSetting({ bookId, fileUrl }: { bookId: string; fileUrl: string }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (offlineSupported() ? isDownloaded(bookId).then((d): State => (d ? "downloaded" : "online-only")) : Promise.resolve<State>("unsupported")).then(
      (next) => live && setState(next),
    );
    return () => {
      live = false;
    };
  }, [bookId]);

  const run = async (work: () => Promise<void>, after: State, before: State) => {
    setError(null);
    setState("working");
    try {
      await work();
      setState(after);
    } catch (e) {
      setState(before);
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    }
  };

  if (state === "checking") return null;
  return (
    <fieldset className={styles.group} data-testid="offline">
      <legend>Offline</legend>
      {state === "unsupported" ? (
        <p className={styles.hint}>This browser cannot keep books for offline reading.</p>
      ) : state === "downloaded" ? (
        <>
          <p className={styles.hint} role="status">
            Available offline on this device. Signing out removes it.
          </p>
          <button type="button" className={styles.tool} onClick={() => void run(() => removeDownload(bookId, fileUrl), "online-only", "downloaded")}>
            Remove download
          </button>
        </>
      ) : (
        <>
          <p className={styles.hint}>Keep this book on this device to read it with no internet.</p>
          <button
            type="button"
            className={styles.primaryTool}
            disabled={state === "working"}
            onClick={() => void run(() => downloadForOffline(bookId, fileUrl), "downloaded", "online-only")}
          >
            {state === "working" ? "Downloading…" : "Download for offline"}
          </button>
        </>
      )}
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
