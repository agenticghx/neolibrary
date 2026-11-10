import { describe, expect, it } from "vitest";
import { mathMl } from "./markdown-math";

describe("LaTeX to MathML", () => {
  it("keeps the LaTeX source in alttext, also when it holds a dollar sign before a quote mark or an ampersand", () => {
    for (const tex of ["x = y", "\\text{cost: } \\$'", "\\begin{aligned} \\$& = 5 \\end{aligned}"]) {
      const ml = mathMl(tex, true)!;
      const alt = tex.replace(/&/g, "&amp;");
      expect(ml.startsWith(`<math alttext="${alt}" xmlns=`), tex).toBe(true);
    }
  });
});
