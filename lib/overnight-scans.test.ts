import { describe, expect, it } from "vitest";
import type { AgentBookDetails } from "@/lib/agent/library";
import { draftNote, notReadCount, pickScans, slugFor } from "./overnight-scans";

const book = (over: Partial<AgentBookDetails>): AgentBookDetails => ({
  id: "12345678-aaaa-4bbb-8ccc-000000000000",
  title: "A Book",
  author: "",
  kind: "pdf",
  pages: 10,
  bytes: 1,
  scan: true,
  textEdition: null,
  editionOf: null,
  cover: { has: true, source: null, catalogue: null, checkedAt: null },
  isbn: null,
  ...over,
});

describe("overnight scan reading (M40 S6)", () => {
  it("picks scans with no text edition and no draft waiting, and nothing else", () => {
    const list = [
      book({ id: "a", title: "Scan" }),
      book({ id: "b", title: "Has edition", textEdition: "e" }),
      book({ id: "c", title: "Text PDF", scan: false }),
      book({ id: "d", title: "EPUB", kind: "epub", scan: false }),
      book({ id: "e", title: "Draft waiting" }),
      book({ id: "f", title: "Is an edition", editionOf: "x" }),
    ];
    expect(pickScans(list, (b) => b.id === "e").map((b) => b.title)).toEqual(["Scan"]);
  });

  it("gives each book a safe folder name that two same titles never share", () => {
    expect(slugFor({ id: "12345678-aaaa", title: "The Pay Off: How Changing the Way We Pay Changes Everything" })).toBe(
      "the-pay-off-how-changing-the-way-we-pay-changes-everything-12345678",
    );
    expect(slugFor({ id: "abcdef12-0000", title: "Café / Ünïcode?" })).toBe("cafe-unicode-abcdef12");
    expect(slugFor({ id: "00000000-1", title: "???" })).toBe("book-00000000");
  });

  it("reads how many pages were not read from the reading script's last line", () => {
    expect(notReadCount("...\nDone: 360 pages read now, 28 blank, 0 not read. At the Batch API's price ...")).toBe(0);
    expect(notReadCount("Done: 12 pages read now, 0 blank, 7 not read (1, 2, 3)")).toBe(7);
    expect(notReadCount("claude -p failed")).toBeNull();
  });

  it("writes a draft note that never sends, and names the one command that would", () => {
    const ready = draftNote({ book: book({ title: "Scan", author: "A. Writer" }), site: "https://site.example", folder: "/f/scan", status: "ready", check: "12 of 360 pages flagged", problems: true });
    expect(ready).toContain("Status: ready");
    expect(ready).toContain("Nothing has been sent to the site.");
    expect(ready).toContain('npx tsx scripts/text-edition-on-subscription.ts send "/f/scan" https://site.example 12345678-aaaa-4bbb-8ccc-000000000000');
    expect(ready).toContain("The check flagged pages to look at");
    const partial = draftNote({ book: book({}), site: "s", folder: "f", status: "partial", why: "7 pages could not be read" });
    expect(partial).toContain("Status: partial");
    expect(partial).toContain("Not finished: 7 pages could not be read.");
    expect(partial).not.toContain("send");
  });
});
