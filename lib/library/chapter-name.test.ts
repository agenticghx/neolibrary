import { describe, expect, it } from "vitest";
import { chapterName } from "./chapter-name";

describe("chapterName", () => {
  it("says 'chapter' before a bare numeral, and keeps a chapter's own name", () => {
    expect(chapterName("I")).toBe("chapter I");
    expect(chapterName("XIV")).toBe("chapter XIV");
    expect(chapterName("8.")).toBe("chapter 8");
    expect(chapterName(" 12 ")).toBe("chapter 12");
    expect(chapterName("8. Minting plastic: from credit to debit cards")).toBe("8. Minting plastic: from credit to debit cards");
    expect(chapterName("Letter II")).toBe("Letter II");
    expect(chapterName("Introduction")).toBe("Introduction");
    expect(chapterName("Mix")).toBe("Mix"); // numerals are upper case in books; a word like "Mix" is a name
    expect(chapterName("")).toBe("this part");
  });
});
