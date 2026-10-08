import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@/lib/auth/service";
import { MAX_BOOK_REQUEST_BYTES } from "@/lib/library/ebook";
import { POST } from "./route";

const at = vi.hoisted(() => ({ user: null as PublicUser | null }));
vi.mock("@/lib/auth/session", () => ({ currentUser: async () => at.user }));

const owner: PublicUser = { id: "00000000-0000-4000-8000-000000000001", email: "o@example.com", name: "O", role: "admin" };

beforeEach(() => {
  at.user = owner;
});

describe("POST /api/books", () => {
  it("refuses a signed-out upload", async () => {
    at.user = null;
    const res = await POST(new Request("http://x/api/books", { method: "POST", body: "x" }));
    expect(res.status).toBe(401);
  });

  it("refuses a body that says it is over one book's limit, before the files are parsed", async () => {
    const res = await POST(
      new Request("http://x/api/books", {
        method: "POST",
        headers: { "content-length": String(MAX_BOOK_REQUEST_BYTES + 1), "content-type": "multipart/form-data; boundary=b" },
        body: "x",
      }),
    );
    expect(res.status).toBe(413);
  });
});
