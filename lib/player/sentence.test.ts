import { describe, expect, it } from "vitest";
import { sentenceAt } from "./sentence";

/** The sentence around the first occurrence of `word`. */
const around = (text: string, word: string) => {
  const { start, end } = sentenceAt(text, text.indexOf(word));
  return text.slice(start, end);
};

describe("sentenceAt", () => {
  const jekyll =
    "That evening Mr. Utterson came home to his bachelor house in sombre spirits and sat down to dinner without relish. It was his custom of a Sunday, when this meal was over, to sit close by the fire. On this night however, as soon as the cloth was taken away, he took up a candle and went into his business room.";

  it("finds the sentence around a word, without the spaces around it", () => {
    expect(around(jekyll, "sombre")).toBe("That evening Mr. Utterson came home to his bachelor house in sombre spirits and sat down to dinner without relish.");
    expect(around(jekyll, "Sunday")).toBe("It was his custom of a Sunday, when this meal was over, to sit close by the fire.");
    expect(around(jekyll, "candle")).toBe("On this night however, as soon as the cloth was taken away, he took up a candle and went into his business room.");
  });

  it("does not end a sentence at a title, an abbreviation, an initial or a number's point", () => {
    expect(around("Dr. Jekyll and Mr. Hyde met St. Paul. Then they parted.", "Hyde")).toBe("Dr. Jekyll and Mr. Hyde met St. Paul.");
    expect(around("It was, e.g. Sunday, a quiet day. Then rain.", "quiet")).toBe("It was, e.g. Sunday, a quiet day.");
    expect(around("J. K. Rowling wrote it. Then she rested.", "wrote")).toBe("J. K. Rowling wrote it.");
    expect(around("It cost 3.5 pounds. Then nothing.", "pounds")).toBe("It cost 3.5 pounds.");
  });

  it("keeps quotes with their sentence", () => {
    const text = "“I am going,” said he. “Wait!” she cried. Then the door closed.";
    expect(around(text, "said")).toBe("“I am going,” said he.");
    expect(around(text, "Wait")).toBe("“Wait!” she cried.");
    expect(around('He said, "Go home." She went.', "Go")).toBe('He said, "Go home."');
  });

  it("ends a sentence at ? ! and an ellipsis", () => {
    const text = "Was it he? It was! And then… Nothing more.";
    expect(around(text, "he")).toBe("Was it he?");
    expect(around(text, "It was")).toBe("It was!");
    expect(around(text, "then")).toBe("And then…");
    expect(around(text, "Nothing")).toBe("Nothing more.");
  });

  it("takes the last sentence without a full stop to the end, and a lone sentence whole", () => {
    expect(around("One sentence. Two without a stop", "without")).toBe("Two without a stop");
    expect(around("  Only one, with spaces  ", "one")).toBe("Only one, with spaces");
  });

  it("splits after etc. and no., which often end a sentence", () => {
    expect(around("He said no. Then he left.", "said")).toBe("He said no.");
    expect(around("Apples, pears, etc. Then lunch.", "pears")).toBe("Apples, pears, etc.");
  });

  it("holds offsets at either end of the text", () => {
    expect(sentenceAt("One. Two.", -5)).toEqual({ start: 0, end: 4 });
    expect(sentenceAt("One. Two.", 99)).toEqual({ start: 5, end: 9 });
  });
});
