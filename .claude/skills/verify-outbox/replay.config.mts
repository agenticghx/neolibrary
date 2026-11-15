// Runs replay.ts (the findings' bug paths, replayed on the real code) and nothing else:
//   npx vitest run --config .claude/skills/verify-outbox/replay.config.mts
// The app's own `npm test` never runs it: its include pattern does not reach this folder.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));

export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: {
    include: [".claude/skills/verify-outbox/replay.ts"],
    environment: "node",
    globalSetup: ["./lib/db/test-db-snapshot.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
