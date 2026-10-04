import { NextResponse, type NextRequest } from "next/server";

// First gate in front of every request (Next.js "proxy"). It only checks
// that a session cookie is present; pages and API routes then verify the
// session against the database (lib/auth/session.ts). Logged-out visitors
// get the sign-in page (pages) or 401 (API and files), never content.
const PUBLIC = [/^\/sign-in$/, /^\/setup$/, /^\/invite\/[^/]+$/, /^\/api\/health$/];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (req.cookies.has("nl_session")) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
