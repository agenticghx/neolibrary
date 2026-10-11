import { describe, expect, it } from "vitest";
import { describeRefused, type OutboxItem } from "./outbox";

// M20 Q2: a note the server refuses stays on the device, described in words
// in the Notes panel, so what the reader wrote is not lost without a word.
const refused = { status: 400, reason: "Book not found.", at: "2026-10-11T12:00:00.000Z" };
const item = (over: Partial<OutboxItem>): OutboxItem => ({ id: "c1", bookId: "b1", body: {}, savedAt: "2026-10-11T11:00:00.000Z", refused, ...over });
const notes = [{ id: "n1", quote: { exact: "a passage" }, body: "my thought" }];

describe("describeRefused", () => {
  it("names a new highlight with its passage and the words the reader wrote", () => {
    const d = describeRefused(item({ body: { kind: "highlight", quote: { exact: "It was on a dreary night" }, body: "Gothic" } }), []);
    expect(d).toEqual({ id: "c1", what: "A new highlight and note", quote: "It was on a dreary night", text: "Gothic", reason: "Book not found." });
    expect(describeRefused(item({ body: { kind: "highlight", quote: { exact: "x" } } }), []).what).toBe("A new highlight");
    expect(describeRefused(item({ body: { kind: "note", body: "about the book" } }), []).what).toBe("A new note");
  });

  it("finds the passage of the note a change, removal or return was for", () => {
    expect(describeRefused(item({ op: "edit", annotationId: "n1", body: { body: "new words" } }), notes)).toMatchObject({
      what: "A change to a note",
      quote: "a passage",
      text: "new words",
    });
    expect(describeRefused(item({ op: "remove", annotationId: "n1" }), notes)).toMatchObject({ what: "Removing a note", quote: "a passage", text: "my thought" });
    const back = item({ op: "restore", annotationId: "gone", body: { annotation: { quote: { exact: "kept here" }, body: "old" } } });
    expect(describeRefused(back, [])).toMatchObject({ what: "Bringing back a note", quote: "kept here", text: "old" });
  });

  it("says the error number when the server gave no reason", () => {
    expect(describeRefused(item({ refused: { ...refused, status: 404, reason: "" } }), []).reason).toBe("The library did not accept it (error 404).");
  });
});
