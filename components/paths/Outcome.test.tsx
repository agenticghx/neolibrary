import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Outcome } from "./Outcome";

describe("Outcome (M14 step 5)", () => {
  it("is empty while the form sends, so a result that repeats the last one is still a change a screen reader reads", () => {
    const saved = { error: null, done: "Saved." };
    expect(renderToStaticMarkup(<Outcome state={saved} pending />)).not.toContain("Saved.");
    expect(renderToStaticMarkup(<Outcome state={saved} pending={false} />)).toContain("Saved.");
    const refused = renderToStaticMarkup(<Outcome state={{ error: "Give the section a name.", done: null }} pending={false} />);
    expect(refused).toContain('role="status"');
    expect(refused).toContain("Give the section a name.");
  });
});
