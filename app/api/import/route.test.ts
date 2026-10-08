import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@/lib/auth/service";
import { MAX_IMPORT_BYTES } from "@/lib/library/export";
import { POST } from "./route";

const at = vi.hoisted(() => ({ user: null as PublicUser | null }));
vi.mock("@/lib/auth/session", () => ({ currentUser: async () => at.user }));

beforeEach(() => {
  at.user = { id: "00000000-0000-4000-8000-000000000001", email: "o@example.com", name: "O", role: "admin" };
});

describe("POST /api/import", () => {
  it("refuses a library file that says it is over 32 MB, before opening the database", async () => {
    const res = await POST(
      new Request("http://x/api/import", {
        method: "POST",
        headers: { "content-length": String(MAX_IMPORT_BYTES + 1), "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(413);
  });
});
