import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // PGlite loads its own WebAssembly files; bundling it breaks that.
  // pdfjs-dist (server side: text for search) loads its own worker file.
  serverExternalPackages: ["@electric-sql/pglite", "pdfjs-dist"],
};

export default nextConfig;
