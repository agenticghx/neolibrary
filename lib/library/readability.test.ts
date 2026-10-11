import { describe, expect, it } from "vitest";
import { compareReadability, formulas, measure, shownGrade, splitSentences, syllables, words } from "./readability";

// M21: Flesch-Kincaid grade and Flesch reading ease. Reference texts are public domain.

describe("the formulas", () => {
  it("match hand-worked values from counts", () => {
    // The opening sentence of the Gettysburg Address, counted by hand: 30 words, 1 sentence, 48 syllables.
    const { grade, ease } = formulas(30, 1, 48);
    expect(grade).toBeCloseTo(14.99, 2);
    expect(ease).toBeCloseTo(41.025, 2);
    // "The cat sat on the mat.": 6 words, 1 sentence, 6 syllables.
    expect(formulas(6, 1, 6).grade).toBeCloseTo(-1.45, 2);
    expect(formulas(6, 1, 6).ease).toBeCloseTo(116.145, 2);
  });
});

describe("measure", () => {
  it("scores the Gettysburg Address opening close to the hand count", () => {
    const r = measure(
      "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal.",
    )!;
    expect(r.words).toBe(30);
    expect(r.sentences).toBe(1);
    expect(Math.abs(r.syllables - 48)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.grade - 14.99)).toBeLessThan(1);
    expect(Math.abs(r.ease - 41.0)).toBeLessThan(6);
  });

  it("rates a children's line as easy and a dense legal-style sentence as hard", () => {
    const easy = measure("The cat sat on the mat. The dog ran to the cat. They had fun.")!;
    expect(easy.sentences).toBe(3);
    expect(easy.grade).toBeLessThan(2);
    expect(easy.ease).toBeGreaterThan(100);
    const hard = measure(
      "Notwithstanding the aforementioned considerations, the commission's determination regarding interregional transmission responsibilities necessitated extraordinarily comprehensive deliberation.",
    )!;
    expect(hard.grade).toBeGreaterThan(20);
    expect(hard.ease).toBeLessThan(0);
  });

  it("scores the Jekyll and Hyde paragraph the reader tests use as adult prose", () => {
    const r = measure(
      "That evening Mr. Utterson came home to his bachelor house in sombre spirits and sat down to dinner without relish. It was his custom of a Sunday, when this meal was over, to sit close by the fire, a volume of some dry divinity on his reading-desk, until the clock of the neighbouring church rang out the hour of twelve, when he would go soberly and gratefully to bed.",
    )!;
    expect(r.sentences).toBe(2); // "Mr." does not end a sentence
    expect(r.grade).toBeGreaterThan(10);
    expect(r.grade).toBeLessThan(20);
  });

  it("returns null for text with no words, and copes with one word", () => {
    expect(measure("")).toBeNull();
    expect(measure("   \n\n  ")).toBeNull();
    expect(measure("— … !")).toBeNull();
    const one = measure("Hello")!;
    expect(one).toMatchObject({ words: 1, sentences: 1, syllables: 2 });
    expect(one.grade).toBeCloseTo(8.4, 1);
  });

  it("counts numbers as words and does not split at a decimal point", () => {
    const r = measure("In 1984 the price rose by 3.5 percent, to $1,000.")!;
    expect(r.sentences).toBe(1);
    expect(r.words).toBe(10); // In, 1984, the, price, rose, by, 3.5, percent, to, 1,000
  });
});

describe("splitSentences", () => {
  it("keeps titles, initials, dotted short forms and No. inside a sentence", () => {
    expect(
      splitSentences(
        "Mr. Utterson met Dr. Jekyll at 5 p.m. on Tuesday. They talked. The U.S. Army paid $3.5 million. J. R. R. Tolkien wrote it, e.g. the first part. See No. 5 here.",
      ),
    ).toEqual([
      "Mr. Utterson met Dr. Jekyll at 5 p.m. on Tuesday.",
      "They talked.",
      "The U.S. Army paid $3.5 million.",
      "J. R. R. Tolkien wrote it, e.g. the first part.",
      "See No. 5 here.",
    ]);
  });

  it("handles quotes, straight and curly, and ends a sentence at a paragraph break", () => {
    expect(splitSentences('"Stop!" she said. "Why?" He left.')).toEqual(['"Stop!" she said.', '"Why?"', "He left."]);
    expect(splitSentences("“Is it you?” he asked. ‘Yes.’ Then silence")).toEqual(["“Is it you?” he asked.", "‘Yes.’", "Then silence"]);
    expect(splitSentences("A heading\n\nThe text starts here. It goes on")).toEqual(["A heading", "The text starts here.", "It goes on"]);
    expect(splitSentences("Wait... Then it came! Really?")).toEqual(["Wait...", "Then it came!", "Really?"]);
  });
});

describe("words", () => {
  it("keeps contractions, hyphenated words and numbers whole, and drops lone dashes", () => {
    expect(words("Don't stop — it's a well-known fact: 3.5 and/or 1,000.")).toEqual([
      "Don't",
      "stop",
      "it's",
      "a",
      "well-known",
      "fact",
      "3.5",
      "and",
      "or",
      "1,000",
    ]);
  });
});

describe("syllables", () => {
  it("gets nearly all of 115 common words right, chosen before the rules were tuned, and none off by more than one", () => {
    // Dictionary counts. On first run 109 of 115 were exact; one rule ("-llion") was added after.
    const list: Record<string, number> = {
      computer: 3, important: 3, information: 4, development: 4, community: 4, president: 3, university: 5, education: 4,
      decision: 3, electric: 3, industry: 3, station: 2, coal: 1, nuclear: 3, storm: 1, hurricane: 3, engineering: 4,
      consumer: 3, reliable: 4, infrastructure: 4, renewable: 4, distribution: 4, frequency: 3, capacity: 4, demand: 2,
      supply: 2, economy: 4, together: 3, children: 2, something: 2, money: 2, anything: 3, region: 2, religious: 3,
      anxious: 2, obvious: 3, serious: 3, eye: 1, wire: 1, line: 1, kilowatt: 3, megawatt: 3, copper: 2, wooden: 2,
      built: 1, rolled: 1, ruined: 2, fluid: 2, mountain: 2, river: 2, village: 2, engine: 2, machine: 2, million: 2,
      billion: 2, dollar: 2, cost: 1, costs: 1, owner: 2, owners: 2, private: 2, public: 2, local: 2, state: 1, states: 1,
      policy: 3, political: 4, citizen: 3, example: 3, possible: 3, probably: 3, usually: 4, already: 3, several: 3,
      between: 2, without: 2, around: 2, another: 3, whether: 2, either: 2, neither: 2, although: 2, enough: 2, across: 2,
      inside: 2, outside: 2, became: 2, become: 2, before: 2, later: 2, early: 2, ready: 2, heavy: 2, easy: 2, easily: 3,
      quickly: 2, finally: 3, certainly: 3, completely: 3, especially: 4, immediately: 5, independent: 4, technology: 4,
      electrical: 4, controlled: 2, produced: 2, increased: 2, reduced: 2, changed: 1, needed: 2, started: 2, happened: 2,
      decided: 3, opened: 2, believed: 2,
    };
    const entries = Object.entries(list);
    expect(entries).toHaveLength(115);
    const off = entries.map(([w, n]) => syllables(w) - n);
    expect(off.filter((d) => d === 0).length).toBeGreaterThanOrEqual(110);
    expect(off.every((d) => Math.abs(d) <= 1)).toBe(true);
  });

  it("handles silent e, -es, -ed, -le and vowel pairs said apart", () => {
    const cases: [string, number][] = [
      ["make", 1], ["makes", 1], ["boxes", 2], ["table", 2], ["people", 2], ["jumped", 1], ["wanted", 2],
      ["radio", 3], ["media", 3], ["social", 2], ["nation", 2], ["curious", 3], ["precious", 2], ["beautiful", 3],
      ["readability", 5], ["the", 1], ["you", 1], ["couldn't", 2],
    ];
    for (const [w, n] of cases) expect([w, syllables(w)]).toEqual([w, n]);
  });

  it("estimates numbers by their digits, letter-only abbreviations by their letters, and is never 0", () => {
    expect(syllables("1984")).toBe(4);
    expect(syllables("3.5")).toBe(2);
    expect(syllables("1950s")).toBe(4);
    expect(syllables("PJM")).toBe(3);
    expect(syllables("a")).toBe(1);
    expect(syllables("Hyde's")).toBe(1);
  });
});

describe("compareReadability", () => {
  it("gives the two grades, their spoken label and a note, with whole grades never below 0", () => {
    const r = compareReadability(
      "Notwithstanding the aforementioned considerations, the commission's determination necessitated extraordinarily comprehensive deliberation.",
      "The group thought hard. It took a long time.",
    )!;
    expect(r.from).toBeGreaterThan(r.to);
    expect(r.label).toBe(`Reading level: original grade ${r.from}, this rewrite grade ${r.to}`);
    expect(r.note).toMatch(/not meaning/);
    expect(r.to).toBe(0); // its formula grade is below 0
    expect(shownGrade(-3.2)).toBe(0);
    expect(shownGrade(8.5)).toBe(9);
  });

  it("is null when either text has no words", () => {
    expect(compareReadability("", "Some words.")).toBeNull();
    expect(compareReadability("Some words.", " ")).toBeNull();
  });
});
