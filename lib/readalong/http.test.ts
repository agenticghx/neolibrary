import { describe, expect, it } from "vitest";
import { bodyBytes } from "./http";

/** M13 (c3): request bodies are read up to a limit, whether or not they say how long they are. */
const stream = (n: number, piece = 64 * 1024) => {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= n) return c.close();
      const k = Math.min(piece, n - sent);
      sent += k;
      c.enqueue(new Uint8Array(k));
    },
  });
};

describe("bodyBytes", () => {
  it("refuses a body that says it is too large, without reading it", async () => {
    const res = (await bodyBytes(new Request("http://x", { method: "POST", headers: { "content-length": "3000000" }, body: "x" }), 2 * 1024 * 1024)) as Response;
    expect(res.status).toBe(413);
  });

  it("stops reading a body with no stated length once it passes the limit", async () => {
    const req = new Request("http://x", { method: "POST", body: stream(5 * 1024 * 1024), duplex: "half" } as RequestInit);
    const res = (await bodyBytes(req, 2 * 1024 * 1024)) as Response;
    expect(res.status).toBe(413);
  });

  it("returns a body within the limit", async () => {
    const req = new Request("http://x", { method: "POST", body: stream(1000, 300), duplex: "half" } as RequestInit);
    expect(((await bodyBytes(req, 2000)) as Uint8Array).byteLength).toBe(1000);
  });
});
