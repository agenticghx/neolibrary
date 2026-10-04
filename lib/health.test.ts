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
});
