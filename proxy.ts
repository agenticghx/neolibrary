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
const PUBLIC = [/^\/sign-in$/, /^\/setup$/, /^\/invite\/[^/]+$/, /^\/api\/health$/];

export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV === "development") {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' blob:",
    "img-src 'self' blob: data: https://upload.wikimedia.org",
    "font-src 'self' blob: data:",
    "media-src 'self' blob:",
    "connect-src 'self' blob:",
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
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

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|fonts/).*)"],
};
