import { NextResponse, type NextRequest } from "next/server";
import { agentUnauthorised } from "@/lib/auth/agent-401";

// First gate in front of every request (Next.js "proxy").
//
// 1. Login: it only checks that a session cookie is present; pages and API
//    routes then verify the session against the database (lib/auth/session.ts).
//    Logged-out visitors get the sign-in page (pages) or 401 (API and files).
//    Agent routes (/api/agent/*) use an API token instead of the cookie: a
//    request with an `Authorization: Bearer` header passes this gate and the
//    route checks the token (lib/auth/agent.ts).
// 2. Content Security Policy on every page: only Next.js's own scripts (which
//    carry this request's nonce) may run. Books can contain JavaScript; the
//    reader shows them in blob: frames, which inherit this policy, so their
//    scripts are blocked (foliate-js requires this).
const PUBLIC = [/^\/sign-in$/, /^\/setup$/, /^\/invite\/[^/]+$/, /^\/api\/health$/, /^\/sw\.js$/, /^\/manifest\.webmanifest$/];

export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV === "development") {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' blob:",
    // A scaled Commons thumbnail is served from thumb.wikimedia.org. A file
    // that needs no scaling stays on upload.wikimedia.org. Omit the first
    // host and See it draws a broken icon in an empty box (measured 2026-10-09).
    "img-src 'self' blob: data: https://upload.wikimedia.org https://thumb.wikimedia.org",
    "font-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self' blob:",
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

function withPolicy(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "same-origin");
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const agent = pathname.startsWith("/api/agent/") && /^Bearer\s/i.test(req.headers.get("authorization") ?? "");
  const allowed = PUBLIC.some((re) => re.test(pathname)) || req.cookies.has("nl_session") || agent;
  if (!allowed) {
    if (pathname.startsWith("/api/agent/")) return agentUnauthorised();
    if (isApi) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return isApi ? NextResponse.next() : withPolicy(req);
}

// Not run for the upload routes (POST /api/books, read-along, voice notes,
// and the library import): Next.js holds a request's whole body while this
// proxy runs, and passes on at most 10 MB of it. Books may be 200 MB, a
// voice note 10 MB, a library file 32 MB, and audio parts larger than the
// proxy's cut. Those routes check the session themselves before reading any
// of the body (currentUser() first), and they stop reading at their own
// limit (lib/http-body.ts), so a signed-out or oversized upload is refused
// without the rest of it being held.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|icon.svg|icons/|favicon.ico|fonts/|api/books$|api/books/[^/]+/readalong|api/books/[^/]+/voice-notes|api/import$).*)",
  ],
};
