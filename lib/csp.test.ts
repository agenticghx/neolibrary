import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, HSTS, proxy } from "@/proxy";

describe("HTTPS only (M20 Q1)", () => {
  const request = (path: string, proto: string, signedIn = true) =>
    new NextRequest(`http://localhost${path}`, {
      headers: { "x-forwarded-proto": proto, ...(signedIn ? { cookie: "nl_session=x" } : {}) },
    });

  it("tells the browser to use https for a year, on pages, API answers and the sign-in redirect", () => {
    expect(HSTS).toBe("max-age=31536000");
    for (const req of [request("/library", "https"), request("/api/health", "https"), request("/library", "https", false)]) {
      expect(proxy(req).headers.get("strict-transport-security"), req.nextUrl.pathname).toBe(HSTS);
    }
    expect(proxy(request("/library", "https", false)).status).toBe(307);
  });

  it("says nothing over plain http (the local test servers)", () => {
    expect(proxy(request("/library", "http")).headers.get("strict-transport-security")).toBeNull();
  });
});

describe("content security policy", () => {
  it("lets only this site frame its pages: the reader's own book frames need it in Safari", () => {
    // The reader shows each chapter in a blob: frame, which inherits this
    // policy. With frame-ancestors 'none', Safari refused those frames and
    // books never opened (2026-10-04); Chrome did not. 'self' still stops
    // other sites from embedding the library.
    const csp = contentSecurityPolicy("n0nce", false);
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src 'self' blob:");
    expect(csp).toContain("script-src 'self' 'nonce-n0nce' 'strict-dynamic'");
  });

  it("allows a scaled Wikimedia thumbnail, and no other picture host", () => {
    // Commons puts a scaled thumbnail on thumb.wikimedia.org (measured
    // 2026-10-09, a search for NREL). The original, and a file small enough
    // to need no scaling, stay on upload.wikimedia.org. The rule names both
    // hosts and nothing else, so a book page cannot load a picture from anywhere.
    const img = contentSecurityPolicy("n0nce", false)
      .split("; ")
      .find((d) => d.startsWith("img-src "));
    expect(img).toBe("img-src 'self' blob: data: https://upload.wikimedia.org https://thumb.wikimedia.org");
  });
});
