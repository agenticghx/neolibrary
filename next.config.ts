import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // PGlite loads its own WebAssembly files; bundling it breaks that.
  // pdfjs-dist (server side: text for search) loads its own worker file.
  serverExternalPackages: ["@electric-sql/pglite", "pdfjs-dist"],
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
