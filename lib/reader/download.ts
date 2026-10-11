/**
 * Downloads a book's file for the reader (M20 Q8). A large PDF on a slow
 * phone connection can take minutes, so there is no limit on the whole
 * download; it gives up only when nothing has arrived for `stallMs` (the
 * connection has stopped). `onProgress` hears each piece: bytes so far, and
 * the whole size when the server says it (0 when it does not).
 */
export async function downloadBook(
  url: string,
  { stallMs, onProgress, fetchImpl = fetch }: { stallMs: number; onProgress?: (got: number, total: number) => void; fetchImpl?: typeof fetch },
): Promise<Blob> {
  const stop = new AbortController();
  let stall: ReturnType<typeof setTimeout> | undefined;
  const wait = () => {
    clearTimeout(stall);
    stall = setTimeout(() => stop.abort(new Error(`nothing arrived for ${stallMs} ms`)), stallMs);
  };
  // Rejects when the download is stopped, so a piece that never comes cannot hold the wait.
  const stopped = new Promise<never>((_, reject) => stop.signal.addEventListener("abort", () => reject(stop.signal.reason), { once: true }));
  stopped.catch(() => {});
  wait();
  try {
    const res = await fetchImpl(url, { signal: stop.signal });
    if (!res.ok) throw new Error(`file ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    if (!res.body) return await res.blob();
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      wait();
      const { done, value } = await Promise.race([reader.read(), stopped]);
      if (done) break;
      parts.push(value);
      got += value.byteLength;
      onProgress?.(got, total);
    }
    return new Blob(parts as BlobPart[], { type: res.headers.get("content-type") ?? "" });
  } finally {
    clearTimeout(stall);
  }
}

/** "12 of 80 MB", for the line shown while a book downloads; null while too little is known to say. */
export function downloadedWords(got: number, total: number): string | null {
  if (!total || total < 2 * 1024 * 1024) return null;
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0);
  return `${mb(got)} of ${mb(total)} MB`;
}
