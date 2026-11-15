// Runs only the replays of the verify-spending skill (never part of `npm test`: their names end in .replay.ts).
// From the repository's root: npx vitest run --config .claude/skills/verify-spending/replay/vitest.config.mts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: {
    include: [".claude/skills/verify-spending/replay/*.replay.ts"],
    environment: "node",
    globalSetup: ["./lib/db/test-db-snapshot.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
