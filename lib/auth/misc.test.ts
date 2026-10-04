import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./crypto";
import { createRateLimiter } from "./rate-limit";
import { checkSetupCode } from "./setup-code";
import { signFileUrl, verifyFileSignature } from "@/lib/signed-url";
import { MemoryStorage } from "@/lib/storage";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("a long passphrase");
    expect(await verifyPassword("a long passphrase", h)).toBe(true);
    expect(await verifyPassword("a long passphrasf", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("rate limiter", () => {
  it("blocks after the limit and frees up after the window", () => {
    const rl = createRateLimiter(3, 1000);
    expect([rl.allow("k", 0), rl.allow("k", 1), rl.allow("k", 2), rl.allow("k", 3)]).toEqual([true, true, true, false]);
    expect(rl.allow("k", 1500)).toBe(true);
    expect(rl.allow("other", 3)).toBe(true);
  });
});

describe("setup code", () => {
  it("matches SETUP_CODE exactly", () => {
    expect(checkSetupCode("  test-code ", { SETUP_CODE: "test-code" })).toBe(true);
    expect(checkSetupCode("wrong", { SETUP_CODE: "test-code" })).toBe(false);
  });
});

describe("signed file links", () => {
  const secret = "s3cret";
  it("work for their key until they expire", () => {
    const now = Date.UTC(2026, 0, 1);
    const url = new URL(signFileUrl(secret, "books/a b.epub", now), "http://x");
    expect(url.pathname).toBe("/api/files/books/a%20b.epub");
    const [exp, sig] = [url.searchParams.get("exp"), url.searchParams.get("sig")];
    expect(verifyFileSignature(secret, "books/a b.epub", exp, sig, now + 60_000)).toBe(true);
    expect(verifyFileSignature(secret, "books/a b.epub", exp, sig, now + 6 * 60_000)).toBe(false);
    expect(verifyFileSignature(secret, "books/other.epub", exp, sig, now)).toBe(false);
    expect(verifyFileSignature("other", "books/a b.epub", exp, sig, now)).toBe(false);
    expect(verifyFileSignature(secret, "books/a b.epub", null, sig, now)).toBe(false);
  });
});

describe("memory storage", () => {
  it("stores, returns and deletes files, and refuses unsafe keys", async () => {
    const s = new MemoryStorage();
    await s.put("books/x.epub", new Uint8Array([1, 2]), "application/epub+zip");
    expect((await s.get("books/x.epub"))?.contentType).toBe("application/epub+zip");
    await s.delete("books/x.epub");
    expect(await s.get("books/x.epub")).toBeNull();
    await expect(s.put("../etc/passwd", new Uint8Array(), "x")).rejects.toThrow("Unsafe");
  });
});
