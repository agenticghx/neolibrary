import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // PGlite loads its own WebAssembly files; bundling it breaks that.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
