import { describe, expect, it } from "vitest";
import { cleanMinutes, clearSession, describeRemaining, focusNoteBody, formatRemaining, isOver, loadSession, remainingMs, saveSession, startSession } from "./focus-session";

const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-00000000000${++n}`;
};

describe("a focus session with a question (M26 R3)", () => {
  it("starts with a question and a timer, and ends that many minutes later", () => {
    const s = startSession({ bookId: "b1", question: "  Why does  the Traveller go forward? ", minutes: 50 }, 1_000_000, ids());
    expect(s).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      noteId: "00000000-0000-4000-8000-000000000002",
      bookId: "b1",
      question: "Why does the Traveller go forward?",
      minutes: 50,
      startedAt: 1_000_000,
      endsAt: 1_000_000 + 50 * 60_000,
    });
    expect(remainingMs(s, 1_000_000)).toBe(3_000_000);
    expect(remainingMs(s, 1_000_000 + 49 * 60_000)).toBe(60_000);
    expect(isOver(s, 1_000_000 + 49 * 60_000)).toBe(false);
    expect(remainingMs(s, 1_000_000 + 51 * 60_000)).toBe(0);
    expect(isOver(s, 1_000_000 + 50 * 60_000)).toBe(true);
  });

  it("refuses a blank question and a timer out of range", () => {
    expect(() => startSession({ bookId: "b1", question: "   ", minutes: 50 })).toThrow(/question/);
    expect(() => startSession({ bookId: "b1", question: "Q?", minutes: 0 })).toThrow(/minutes/);
    expect(cleanMinutes("")).toBeNull();
    expect(cleanMinutes("abc")).toBeNull();
    expect(cleanMinutes(0)).toBeNull();
    expect(cleanMinutes(181)).toBeNull();
    expect(cleanMinutes("25.9")).toBe(25);
    expect(cleanMinutes(1)).toBe(1);
  });

  it("shows the time left as a kitchen timer does, and says it in words", () => {
    expect(formatRemaining(50 * 60_000)).toBe("50:00");
    expect(formatRemaining(9 * 60_000 + 5_000)).toBe("9:05");
    expect(formatRemaining(6_500)).toBe("0:07");
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-5)).toBe("0:00");
    expect(describeRemaining(50 * 60_000)).toBe("50 minutes left");
    expect(describeRemaining(60_000)).toBe("1 minute left");
    expect(describeRemaining(59_000)).toBe("under a minute left");
  });

  it("the note repeats the question, so it stands on its own", () => {
    expect(focusNoteBody("Why forward?", " Because the future is where the story is. ")).toBe("Question: Why forward?\n\nAnswer: Because the future is where the story is.");
    expect(focusNoteBody("", "Just this")).toBe("Just this");
  });

  it("survives a reload: saved on the device, loaded back for the same book only, ignored when malformed", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const s = startSession({ bookId: "b1", question: "Q?", minutes: 2 }, 5_000, ids());
    saveSession(s, storage);
    expect(loadSession("b1", storage)).toEqual(s);
    expect(loadSession("other-book", storage)).toBeNull();
    store.set("neolibrary.focus.v1", "{not json");
    expect(loadSession("b1", storage)).toBeNull();
    store.set("neolibrary.focus.v1", JSON.stringify({ bookId: "b1", id: "x" }));
    expect(loadSession("b1", storage)).toBeNull();
    saveSession(s, storage);
    clearSession(storage);
    expect(loadSession("b1", storage)).toBeNull();
    // No storage at all (a private window): nothing breaks.
    expect(loadSession("b1", null)).toBeNull();
    saveSession(s, null);
    clearSession(null);
  });
});
