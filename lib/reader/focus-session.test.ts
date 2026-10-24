import { describe, expect, it } from "vitest";
import {
  answerWordsFor,
  cleanDays,
  answerFromNote,
  cleanMinutes,
  clearSession,
  countWords,
  describeRemaining,
  earlyAnswerProblem,
  endedLabel,
  focusNoteBody,
  formatRemaining,
  fromServer,
  isOver,
  loadSession,
  remainingMs,
  saveSession,
  startSession,
  waitRemainingMs,
} from "./focus-session";

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

  it("Reading stats shows only the answer under the question; a note rewritten in another shape is shown whole", () => {
    expect(answerFromNote(focusNoteBody("Why forward?", "Because.\n\nAnd more."))).toBe("Because.\n\nAnd more.");
    expect(answerFromNote("My own words now, no labels.")).toBe("My own words now, no labels.");
    expect(answerFromNote("Question: Why?\nAnswer: one newline only")).toBe("Question: Why?\nAnswer: one newline only");
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

describe("the session from the server (M26 R4a)", () => {
  const server = { id: "s1", bookId: "b1", question: "Why?", minutes: 2, noteId: "n1", remainingMs: 90_000 };

  it("ends at this device's now plus the time the server says is left, whatever this device's clock says", () => {
    const s = fromServer(server, null, 1_000_000);
    expect(s).toMatchObject({ id: "s1", bookId: "b1", noteId: "n1", endsAt: 1_090_000, startedAt: 970_000 });
    expect(formatRemaining(remainingMs(s, 1_000_000))).toBe("1:30");
  });

  it("a copy of the same session on this device keeps its own end (a reload does not move it); another session's copy is ignored", () => {
    const local = { id: "s1", bookId: "b1", question: "Why?", minutes: 2, startedAt: 0, endsAt: 60_000, noteId: "n1" };
    expect(fromServer(server, local, 1_000_000).endsAt).toBe(60_000);
    expect(fromServer(server, { ...local, id: "s0" }, 1_000_000).endsAt).toBe(1_090_000);
  });
});

describe("the ways out (M26 R4b)", () => {
  it("counts words as a reader would: punctuation, new lines and double spaces are not words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  \n ")).toBe(0);
    expect(countWords("Because the future, not the past.")).toBe(6);
    expect(countWords("one  two\n\nthree — four… five")).toBe(5);
    expect(countWords("don't stop: it's the 1890s, well-known")).toBe(6);
    expect(countWords("Café über naïve")).toBe(3);
  });

  it("an early answer needs 40 words, unless the reader may already leave", () => {
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    expect(earlyAnswerProblem(words(39), false)).toBe("To leave before the time is up, write at least 40 words (this has 39).");
    expect(earlyAnswerProblem(words(40), false)).toBeNull();
    expect(earlyAnswerProblem("Short.", true)).toBeNull();
  });

  it("the wait from the server: at this device's now plus what is left; it is over when it runs out", () => {
    const now = 1_000_000;
    const s = fromServer({ id: "f1", bookId: "b1", question: "Q?", minutes: 30, noteId: "n1", remainingMs: 20 * 60_000, waitRemainingMs: 9 * 60_000 }, null, now);
    expect(s.waitEndsAt).toBe(now + 9 * 60_000);
    expect(waitRemainingMs(s, now + 60_000)).toBe(8 * 60_000);
    expect(isOver(s, now + 60_000)).toBe(false);
    expect(isOver(s, now + 9 * 60_000)).toBe(true);
    // A reload keeps this device's wait; a wait cancelled elsewhere is gone.
    expect(fromServer({ id: "f1", bookId: "b1", question: "Q?", minutes: 30, noteId: "n1", remainingMs: 1, waitRemainingMs: 5 }, s, now + 500).waitEndsAt).toBe(s.waitEndsAt);
    expect(fromServer({ id: "f1", bookId: "b1", question: "Q?", minutes: 30, noteId: "n1", remainingMs: 1, waitRemainingMs: null }, s, now + 500).waitEndsAt).toBeNull();
    expect(waitRemainingMs({ ...s, waitEndsAt: null })).toBeNull();
  });

  it("names how a session ended for Reading stats", () => {
    expect(endedLabel("time")).toBe("On time");
    expect(endedLabel("answered")).toBe("Answered early");
    expect(endedLabel("waited")).toBe("Left after a wait");
    expect(endedLabel("early")).toBe("Ended early");
    expect(endedLabel(null)).toBeNull();
  });
});

describe("whole-book focus (M26 R5)", () => {
  it("lasts 1 to 30 whole days", () => {
    expect(cleanDays("14")).toBe(14);
    expect(cleanDays(30)).toBe(30);
    for (const bad of [0, 31, "", "x", -1, null]) expect(cleanDays(bad), String(bad)).toBeNull();
  });

  it("an early answer needs 150 words for a whole book, 40 for a sitting", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    expect(answerWordsFor("book")).toBe(150);
    expect(answerWordsFor("sitting")).toBe(40);
    expect(earlyAnswerProblem(words(149), false, answerWordsFor("book"))).toBe("To leave before the time is up, write at least 150 words (this has 149).");
    expect(earlyAnswerProblem(words(150), false, answerWordsFor("book"))).toBeNull();
  });

  it("says a book read to its end was finished", () => {
    expect(endedLabel("finished")).toBe("Finished the book");
  });
});
