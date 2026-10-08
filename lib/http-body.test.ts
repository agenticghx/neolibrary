import { describe, expect, it } from "vitest";
import { cappedFormData, jsonAtMost } from "./http-body";

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

describe("cappedFormData", () => {
  it("parses a form that fits", async () => {
    const boundary = "b";
    const body = [`--${boundary}`, 'Content-Disposition: form-data; name="files"; filename="a.epub"', "Content-Type: application/epub+zip", "", "hello", `--${boundary}--`, ""].join("\r\n");
    const form = await cappedFormData(
      new Request("http://x", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body }),
      1024 * 1024,
    );
    expect(form).toBeInstanceOf(FormData);
    const file = (form as FormData).get("files");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("a.epub");
    expect(await (file as File).text()).toBe("hello");
  });

  it("refuses a body that says it is too large, without parsing it", async () => {
    const res = (await cappedFormData(
      new Request("http://x", { method: "POST", headers: { "content-length": "3000000", "content-type": "multipart/form-data; boundary=b" }, body: "x" }),
      2 * 1024 * 1024,
    )) as Response;
    expect(res.status).toBe(413);
  });

  it("stops a stream that never says its length", async () => {
    const req = new Request("http://x", { method: "POST", body: stream(5 * 1024 * 1024), duplex: "half" } as RequestInit);
    const res = (await cappedFormData(req, 2 * 1024 * 1024)) as Response;
    expect(res.status).toBe(413);
  });
});

describe("jsonAtMost", () => {
  it("returns the JSON when it fits, and refuses one that says it does not", async () => {
    const ok = await jsonAtMost(new Request("http://x", { method: "POST", body: JSON.stringify({ books: 1 }) }), 1000);
    expect(ok).toEqual({ books: 1 });
    const res = (await jsonAtMost(
      new Request("http://x", { method: "POST", headers: { "content-length": "9000000" }, body: "{}" }),
      1024 * 1024,
    )) as Response;
    expect(res.status).toBe(413);
  });

  it("says when the body is not JSON", async () => {
    const res = (await jsonAtMost(new Request("http://x", { method: "POST", body: "not json" }), 1000)) as Response;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That file is not valid JSON." });
  });
});
