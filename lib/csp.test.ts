import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "@/proxy";

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
});
