import { afterEach, expect, test, vi } from "vitest";
import { copyText } from "./copy";

afterEach(() => vi.unstubAllGlobals());

test("says yes only when the browser took the text", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  expect(await copyText("a passage")).toBe(true);
  expect(writeText).toHaveBeenCalledWith("a passage");
});

test("says no when the browser refuses, or has no clipboard", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: async () => Promise.reject(new Error("denied")) } });
  expect(await copyText("a passage")).toBe(false);
  vi.stubGlobal("navigator", {});
  expect(await copyText("a passage")).toBe(false);
});
