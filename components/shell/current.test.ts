import { describe, expect, it } from "vitest";
import { isCurrent } from "./current";

const at = (path: string) => {
  const url = new URL(path, "http://local");
  return [url.pathname, url.searchParams] as const;
};

describe("isCurrent", () => {
  it("marks Home only on Home", () => {
    expect(isCurrent("/", ...at("/"))).toBe(true);
    expect(isCurrent("/", ...at("/library"))).toBe(false);
    expect(isCurrent("/", ...at("/paths"), "section")).toBe(false);
  });

  it("tells the library's filters and collections apart", () => {
    expect(isCurrent("/library", ...at("/library"))).toBe(true);
    expect(isCurrent("/library", ...at("/library?show=all"))).toBe(true);
    expect(isCurrent("/library", ...at("/library?show=want"))).toBe(false);
    expect(isCurrent("/library?show=want", ...at("/library?show=want&sort=title"))).toBe(true);
    expect(isCurrent("/library", ...at("/library?c=abc"))).toBe(false);
    expect(isCurrent("/library?c=abc", ...at("/library?c=abc&q=x"))).toBe(true);
    expect(isCurrent("/library?c=abc", ...at("/library?c=def"))).toBe(false);
    expect(isCurrent("/library", ...at("/library?new=collection"))).toBe(false);
    expect(isCurrent("/library?new=collection", ...at("/library?new=collection"))).toBe(true);
  });

  it("marks one Path exactly, and the Paths tab for every Path page", () => {
    expect(isCurrent("/paths/hidden-machinery", ...at("/paths/hidden-machinery"))).toBe(true);
    expect(isCurrent("/paths/hidden-machinery", ...at("/paths/other"))).toBe(false);
    expect(isCurrent("/paths", ...at("/paths/hidden-machinery"))).toBe(false);
    expect(isCurrent("/paths", ...at("/paths/hidden-machinery"), "section")).toBe(true);
    expect(isCurrent("/paths", ...at("/pathsx"), "section")).toBe(false);
    expect(isCurrent("/library", ...at("/library?show=want"), "section")).toBe(true);
  });
});
