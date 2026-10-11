import { describe, expect, it } from "vitest";
import { downloadBook, downloadedWords } from "./download";

// M20 Q8: a book's download may take as long as it needs while bytes keep arriving, and gives up only when the
// connection stops. Before, the reader gave up 30 s after it began opening, download included.

/** A fake server: `chunks` pieces of `size` bytes, `gapMs` apart; `stallAfter` stops sending after that many. */
function slowFetch(chunks: number, size: number, gapMs: number, stallAfter = Infinity): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent >= chunks) return controller.close();
        if (sent >= stallAfter) return new Promise<void>(() => {}); // never sends again
        await new Promise((r) => setTimeout(r, gapMs));
        if (init?.signal?.aborted) return;
        controller.enqueue(new Uint8Array(size).fill(sent));
        sent += 1;
      },
    });
    return new Response(body, { headers: { "content-length": String(chunks * size), "content-type": "application/pdf" } });
  }) as typeof fetch;
}

describe("downloadBook", () => {
  it("takes longer than the stall limit in all, as long as pieces keep coming, and reports progress", async () => {
    const seen: [number, number][] = [];
    const started = Date.now();
    const blob = await downloadBook("/f", { stallMs: 60, fetchImpl: slowFetch(8, 1000, 20), onProgress: (g, t) => seen.push([g, t]) });
    expect(Date.now() - started).toBeGreaterThan(120); // two stall limits in all
    expect(blob.size).toBe(8000);
    expect(blob.type).toBe("application/pdf");
    expect(seen.at(-1)).toEqual([8000, 8000]);
    expect(seen.map(([g]) => g)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]);
  });

  it("gives up when nothing arrives for the stall limit", async () => {
    await expect(downloadBook("/f", { stallMs: 60, fetchImpl: slowFetch(8, 1000, 10, 3) })).rejects.toThrow("nothing arrived for 60 ms");
  });

  it("says a refused file", async () => {
    const refused = (async () => new Response("no", { status: 403 })) as typeof fetch;
    await expect(downloadBook("/f", { stallMs: 60, fetchImpl: refused })).rejects.toThrow("file 403");
  });
});

describe("downloadedWords", () => {
  it("speaks in MB once the file is big enough to wait for", () => {
    expect(downloadedWords(100, 0)).toBeNull();
    expect(downloadedWords(100, 1024 * 1024)).toBeNull();
    expect(downloadedWords(3 * 1024 * 1024, 8 * 1024 * 1024)).toBe("3.0 of 8.0 MB");
    expect(downloadedWords(12 * 1024 * 1024, 80 * 1024 * 1024)).toBe("12 of 80 MB");
  });
});
