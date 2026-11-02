import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { resetVisitorLimitsForTests, takeVisitorRequest, VISITOR_LIMITS, visitorAddress } from "./visitor-limit";

// M34 S5: a limit on requests per visitor address.
afterEach(() => resetVisitorLimitsForTests());

describe("takeVisitorRequest", () => {
  it("allows the limit in a window, refuses the next with the wait, and starts again after it", () => {
    const now = 1_000_000;
    for (let i = 0; i < VISITOR_LIMITS.ai.max; i++) expect(takeVisitorRequest("ai", "1.2.3.4", now).ok).toBe(true);
    expect(takeVisitorRequest("ai", "1.2.3.4", now + 15_000)).toEqual({ ok: false, retryAfterSeconds: 45 });
    // Another address, or another kind, has its own count.
    expect(takeVisitorRequest("ai", "5.6.7.8", now).ok).toBe(true);
    expect(takeVisitorRequest("page", "1.2.3.4", now).ok).toBe(true);
    // The window ends: allowed again.
    expect(takeVisitorRequest("ai", "1.2.3.4", now + VISITOR_LIMITS.ai.windowMs).ok).toBe(true);
  });

  it("reads the visitor's address from the first forwarded one", () => {
    expect(visitorAddress(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(visitorAddress(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(visitorAddress(new Headers())).toBe("unknown");
  });
});

describe("the proxy", () => {
  const visit = (path: string, from: string) => proxy(new NextRequest(`http://localhost${path}`, { headers: { "x-forwarded-for": from } }));

  it("answers 429 to an address past the open shelf's page limit, and nobody else", () => {
    for (let i = 0; i < VISITOR_LIMITS.page.max; i++) expect(visit("/browse", "1.1.1.1").status).toBe(200);
    const refused = visit("/browse/00000000-0000-4000-8000-000000000000", "1.1.1.1");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(visit("/browse", "2.2.2.2").status).toBe(200);
    // Other pages are not counted: sign-in still answers.
    expect(visit("/sign-in", "1.1.1.1").status).toBe(200);
  });
});
