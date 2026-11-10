import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    environment: "node",
    // Builds one migrated database before the run; each test copies it (lib/db/test-db.ts).
    globalSetup: ["./lib/db/test-db-snapshot.ts"],
    // Database tests start a fresh in-process Postgres each; give them time.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
