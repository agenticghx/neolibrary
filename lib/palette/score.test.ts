import { describe, expect, it } from "vitest";
import { fold, rank, score, scoreFields } from "./score";

const order = (query: string, texts: string[]) => rank(texts, (t) => score(query, t));

describe("score: letters in order, best at word starts", () => {
  it("matches a subsequence and refuses letters out of order or missing", () => {
    expect(score("tmach", "The Time Machine")).not.toBeNull();
    expect(score("time mach", "The Time Machine")).not.toBeNull();
    expect(score("hcam", "The Time Machine")).toBeNull();
    expect(score("timex", "The Time Machine")).toBeNull();
    expect(score("", "The Time Machine")).toBeNull();
    expect(score("   ", "The Time Machine")).toBeNull();
  });

  it("ignores case and accents", () => {
    expect(fold("Éloïse")).toBe("eloise");
    expect(score("ELOISE", "Héloïse and Abélard")).not.toBeNull();
    expect(score("abel", "Héloïse and Abélard")).not.toBeNull();
  });

  it("ranks word starts and runs above letters scattered inside words", () => {
    // "raid" starts Raiders; in "Afraid" it sits mid-word (still a match: the letters run together).
    expect(order("raid", ["Afraid of the Dark", "Raiders of the Lost Ark"])).toEqual(["Raiders of the Lost Ark", "Afraid of the Dark"]);
    // Word starts T(ime) M(achine) beat the same two letters run together inside "Utmost".
    expect(order("tm", ["Utmost Good", "The Time Machine"])).toEqual(["The Time Machine", "Utmost Good"]);
    // The start of the text beats a later word start.
    expect(order("time", ["The Time Machine", "Time and Again"])[0]).toBe("Time and Again");
    // A whole run ("mach") beats the same letters spread over words.
    expect(order("mach", ["Mary Ann Can Hope", "The Time Machine"])[0]).toBe("The Time Machine");
  });

  it("drops matches whose letters are scattered through the middle of words", () => {
    // f-k-n inside Frankenstein: one word start, then two runs mid-word.
    expect(score("fkn", "Frankenstein")).toBeNull();
    // One letter that starts no word.
    expect(score("t", "Frankenstein")).toBeNull();
    expect(score("f", "Frankenstein")).not.toBeNull();
    // A long note matches a word in it, not a scatter of its letters.
    const note = "The lawyer was a man of a rugged countenance that was never lighted by a smile.";
    expect(score("rugged", note)).not.toBeNull();
    expect(score("ugd", note)).toBeNull(); // letters inside "rugged", none at its start
  });

  it("a shorter text wins a tie", () => {
    expect(order("time", ["Time and Again", "Time"])).toEqual(["Time", "Time and Again"]);
  });
});

describe("scoreFields and rank", () => {
  it("a title match ranks above an author match", () => {
    const books = [
      { title: "Frankenstein", author: "Mary Shelley" },
      { title: "Mary Barton", author: "Elizabeth Gaskell" },
    ];
    const ranked = rank(books, (b) => scoreFields("mary", [[b.title, 1], [b.author, 0.5]]));
    expect(ranked.map((b) => b.title)).toEqual(["Mary Barton", "Frankenstein"]);
    // The author alone still finds the book.
    expect(rank(books, (b) => scoreFields("shelley", [[b.title, 1], [b.author, 0.5]])).map((b) => b.title)).toEqual(["Frankenstein"]);
  });

  it("keeps the given order for equal scores and leaves out what does not match", () => {
    expect(order("x", ["Xa", "Xb", "none"])).toEqual(["Xa", "Xb"]);
    expect(scoreFields("q", [["", 1]])).toBeNull();
  });
});

describe("score: ties", () => {
  it("letters typed together stay together: 'the' is the first word, not t-h at the start and the e of a later word", () => {
    // Equal matches at the start, so the shorter title comes first.
    expect(order("the", ["The Great Escape", "The Box"])).toEqual(["The Box", "The Great Escape"]);
  });
});
