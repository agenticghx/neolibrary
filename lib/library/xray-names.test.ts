import { describe, expect, it } from "vitest";
import { findMentions, findNames, looksLikeHeading, type Paragraph } from "./xray";

/**
 * The name finder on prose like a nonfiction book's (M32 X1b). The rules here
 * came from running it on three of Samuel's own books (a history of the
 * electricity grid, a book on payments, an edition of Descartes), whose text
 * cannot be in the repository: each paragraph below is written to stand for
 * one thing those books showed.
 */
const para = (text: string, i: number): Paragraph => ({ id: `p${i}`, chapterIndex: 0, position: i, text });
const names = (texts: string[]) => findNames(texts.map(para));
const byAlias = (entries: ReturnType<typeof findNames>, alias: string) => entries.find((e) => e.aliases.includes(alias));

describe("the name finder on nonfiction prose", () => {
  it("does not group different organisations by a shared last word, and a common noun is not a name", () => {
    const entries = names([
      "The Bank of England set the rate, and the Bank of China followed; the Central Bank of Nigeria did not. Later the Bank of England explained itself.",
      "Most banks lend; a bank that cannot is in trouble. The Bank of China lent, the Central Bank of Nigeria watched, and every bank waited.",
      "Energy is dear. The Department of Energy and Xcel Energy disagreed; the Department of Energy won, and Xcel Energy paid, as energy prices rose.",
    ]);
    expect(byAlias(entries, "Bank of England")).toBeTruthy();
    expect(byAlias(entries, "Bank of China")).toBeTruthy();
    expect(byAlias(entries, "Bank of England")).not.toBe(byAlias(entries, "Bank of China"));
    expect(byAlias(entries, "Bank")).toBeUndefined(); // "bank" is written in lower case: a kind of thing
    expect(byAlias(entries, "Energy")).toBeUndefined();
    expect(byAlias(entries, "Department of Energy")).not.toBe(byAlias(entries, "Xcel Energy"));
  });

  it("strips a sentence opener or a title word from the front, a title from the end, and a unit after a number", () => {
    const entries = names([
      "He moved there. In Hawaii the sun set, and in Hawaii it rose; Hawaii was warm. See Gaukroger for more, as Gaukroger says.",
      "The turbines were rated at 15 MW GE units, and GE sold them; GE made more. Chapter Three begins here, and Chapter Three ends.",
      "The Fourth Objections came from Arnauld; the Fourth Objections were sharp, and Arnauld knew it. The Explanatory Notes follow.",
    ]);
    expect(byAlias(entries, "Hawaii")).toBeTruthy();
    expect(byAlias(entries, "In Hawaii")).toBeUndefined();
    expect(byAlias(entries, "Gaukroger")).toBeTruthy();
    expect(byAlias(entries, "See Gaukroger")).toBeUndefined();
    expect(byAlias(entries, "GE")).toBeTruthy();
    expect(byAlias(entries, "MW GE")).toBeUndefined();
    expect(entries.some((e) => e.aliases.some((a) => /Chapter|Objections|Notes|Fourth|Explanatory/.test(a)))).toBe(false);
    expect(byAlias(entries, "Arnauld")).toBeTruthy();
  });

  it("keeps an ampersand inside a name, ends a name at a possessive, and leaves adjectives of place alone", () => {
    const entries = names([
      "The utility PG&E paid, and PG&E paid again; Germany’s FinTech firms watched as FinTech grew, and Germany’s banks too, said Germany.",
      "A European firm and a European bank are European; so is Europe, and Europe knows it. The American way is American.",
    ]);
    expect(byAlias(entries, "PG&E")).toBeTruthy();
    expect(byAlias(entries, "Germany")).toBeTruthy();
    expect(byAlias(entries, "FinTech")).toBeTruthy();
    expect(byAlias(entries, "Germany’s FinTech")).toBeUndefined();
    expect(byAlias(entries, "European")).toBeUndefined();
    expect(byAlias(entries, "American")).toBeUndefined();
    expect(byAlias(entries, "Europe")).toBeTruthy();
  });

  it("joins a name only at its ends, and only when one name fits; a first name two people share stays apart", () => {
    const entries = names([
      "The history came from Richard Hirsh, and Richard Hirsh was right; another came from Richard Munson, and Richard Munson was wrong. They met Hirsh and Munson, and Hirsh left while Munson stayed, as did Richard, since Richard always does.",
      "The old man was Sir Danvers, and Sir Danvers spoke once: the name of Sir Danvers Carew was his, and Carew was a member, so Carew left.",
      "The French Thought of the age, the Early Modern French Thought, and French Literature are three things; French Thought is one.",
    ]);
    expect(byAlias(entries, "Richard Hirsh")).not.toBe(byAlias(entries, "Richard Munson"));
    expect(byAlias(entries, "Richard")?.aliases).toEqual(["Richard"]);
    expect(byAlias(entries, "Carew")?.aliases).toEqual(expect.arrayContaining(["Sir Danvers", "Sir Danvers Carew"]));
    expect(byAlias(entries, "Carew")?.name).toBe("Sir Danvers Carew");
    const french = entries.filter((e) => e.aliases.some((a) => a.includes("French")));
    expect(french.every((e) => e.aliases.length <= 2)).toBe(true); // "French" in the middle joins nothing
  });

  it("skips a heading, and counts a mention once, for the longest name", () => {
    expect(looksLikeHeading("CHAPTER 3 The Consolidation of Power")).toBe(true);
    expect(looksLikeHeading("The grid rarely breaches consciousness, for most people.")).toBe(false);
    const paragraphs = [
      para("CHAPTER 3 The Consolidation Of Power", 0),
      para("The Department of Energy ruled. Energy fell; the Department of Energy and the Energy Information Administration agreed.", 1),
      para("Then the Energy Information Administration spoke, and so did the Department of Energy, on energy.", 2),
    ];
    const entries = findNames(paragraphs);
    expect(byAlias(entries, "Department of Energy")).toBeTruthy();
    expect(byAlias(entries, "Energy Information Administration")).toBeTruthy();
    expect(byAlias(entries, "Energy")).toBeUndefined();
    const mentions = findMentions([...entries, { id: "e", name: "Energy", kind: "name", aliases: ["Energy"] }], paragraphs);
    const dept = byAlias(entries, "Department of Energy")!;
    expect(mentions.filter((m) => m.entryId === dept.id).length).toBe(3);
    // "Energy" on its own is counted only where it stands alone: once in paragraph 1, never inside the longer names.
    expect(mentions.filter((m) => m.entryId === "e").map((m) => m.sectionId)).toEqual(["p1"]);
  });
});
