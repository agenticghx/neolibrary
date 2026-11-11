import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // No "Link" response header from React (its hints to fetch style files early). Measured on the live open shelf on
  // 2026-11-11: with that header, Safari's engine (WebKit) fetched the page's pictures two at a time, so 129 covers
  // took 10.7 s; without it, about 2 to 4 s. The same style files are named in the page's head, so nothing is lost.
  reactMaxHeadersLength: 0,
  // PGlite loads its own WebAssembly files; bundling it breaks that.
  // pdfjs-dist (server side: text for search, page pictures) loads its own worker file;
  // @napi-rs/canvas (page pictures, M25) is a native module with a binary per platform.
  serverExternalPackages: ["@electric-sql/pglite", "pdfjs-dist", "@napi-rs/canvas"],
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
