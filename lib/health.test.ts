import { describe, expect, it } from "vitest";
import { health } from "./health";

describe("health", () => {
  it("reports ok and the short commit when Railway provides one", () => {
    expect(health({ RAILWAY_GIT_COMMIT_SHA: "abcdef1234567" })).toEqual({
      status: "ok",
      service: "neolibrary",
      commit: "abcdef1",
    });
    expect(health({}).commit).toBeNull();
  });

  it("reads the commit a laptop deploy sets, and ignores a value that is not a sha", () => {
    expect(health({ NEOLIBRARY_COMMIT: "abc1234" }).commit).toBe("abc1234");
    expect(health({ RAILWAY_GIT_COMMIT_SHA: "abcdef1234567", NEOLIBRARY_COMMIT: "1234567" }).commit).toBe("abcdef1");
    expect(health({ NEOLIBRARY_COMMIT: "not-a-commit" }).commit).toBeNull();
    expect(health({ RAILWAY_GIT_COMMIT_SHA: "short" }).commit).toBeNull();
  });
});
