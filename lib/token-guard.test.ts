import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

// Proves the design-token lint rule really rejects raw values.
async function lint(code: string, codeFilename = "components/Example.module.css") {
  const { results } = await stylelint.lint({ code, codeFilename, configFile: "stylelint.config.mjs" });
  return results[0].warnings.map((w) => w.rule);
}

describe("design-token guard (stylelint)", () => {
  it("rejects raw colours, sizes and spacing outside tokens.css", async () => {
    const rules = await lint(".a {\n  color: #ff0000;\n  font-size: 14px;\n  padding: 12px;\n}\n");
    expect(rules).toContain("color-no-hex");
    expect(rules.filter((r) => r === "scale-unlimited/declaration-strict-value").length).toBeGreaterThanOrEqual(3);
  });

  it("rejects colour functions", async () => {
    expect(await lint(".a {\n  background-color: rgb(0 0 0);\n}\n")).toContain("function-disallowed-list");
  });

  it("accepts token-based values", async () => {
    const rules = await lint(
      ".a {\n  color: var(--ink-900);\n  font-size: var(--text-md);\n  padding: var(--space-2) var(--space-4);\n  margin-top: calc(var(--space-3) * -1);\n}\n",
    );
    expect(rules).toEqual([]);
  });
});
