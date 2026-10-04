import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // PGlite loads its own WebAssembly files; bundling it breaks that.
  // pdfjs-dist (server side: text for search) loads its own worker file.
  serverExternalPackages: ["@electric-sql/pglite", "pdfjs-dist"],
  experimental: {
    // proxy.ts (the sign-in check) runs before every request, and Next.js
    // passes on at most 10 MB of a request body through it by default,
    // cutting the rest off silently. Books may be up to 200 MB
    // (MAX_BOOK_BYTES) and a read-along package zip too (MAX_ZIP_BYTES), so
    // allow a little more than that. Found 2026-10-04: a 12 MB book upload
    // and a 12 MB package arrived cut short (e2e/readalong.spec.ts).
    proxyClientMaxBodySize: 210 * 1024 * 1024,
  },
  // The service worker (M12) must never be cached by the browser, or updates would not reach readers.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
