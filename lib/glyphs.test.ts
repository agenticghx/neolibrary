import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every character we put on a page must be in the bundled fonts' latin subset.
// A missing glyph (e.g. "←") is drawn from a system font, which differs between
// machines and breaks the screenshot comparison (it did, on PR #5).

function latinRanges(css: string): [number, number][] {
  const block = css.split("@font-face").find((b) => b.includes("U+0000-00FF"));
  if (!block) throw new Error("latin subset not found");
  const range = /unicode-range:\s*([^;]+);/.exec(block)![1];
  return range.split(",").map((r) => {
    const [a, b] = r.trim().replace(/U\+/g, "").split("-");
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}

const fonts = [
  "node_modules/@fontsource-variable/source-sans-3/wght.css",
  "node_modules/@fontsource-variable/source-serif-4/opsz.css",
].map((f) => latinRanges(readFileSync(f, "utf8")));

const covered = (cp: number) => fonts.every((ranges) => ranges.some(([a, b]) => cp >= a && cp <= b));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(tsx|ts)$/.test(name) && !name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("characters on pages are in the bundled fonts", () => {
  it("app/, components/ and data/ use only covered characters", () => {
    const problems: string[] = [];
    for (const f of [...files("app"), ...files("components"), ...files("data")]) {
      const source = readFileSync(f, "utf8");
      for (const ch of new Set(source)) {
        const cp = ch.codePointAt(0)!;
        if (cp > 0x7f && !covered(cp)) problems.push(`${f}: "${ch}" (U+${cp.toString(16).toUpperCase().padStart(4, "0")})`);
      }
    }
    expect(problems).toEqual([]);
  });
});
