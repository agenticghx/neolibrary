import { describe, expect, it } from "vitest";
import { matchGenealogyName, type GenealogyName } from "./genealogy-names";

const names: GenealogyName[] = [
  { name: "Gabriel John Utterson", kind: "person", links: 3, tree: false },
  { name: "Henry Jekyll", kind: "person", links: 5, tree: false },
  { name: "Robert Noyce", kind: "person", links: 40, tree: false },
  { name: "Robert Maxwell", kind: "person", links: 2, tree: false },
  { name: "Fairchild Semiconductor", kind: "organisation", links: 30, tree: true },
  { name: "Fairchild Camera and Instrument", kind: "organisation", links: 6, tree: true },
  { name: "Intel", kind: "organisation", links: 60, tree: true },
  { name: "Texas Instruments", kind: "organisation", links: 20, tree: false },
];
const entry = (name: string, kind = "name", aliases: string[] = []) => ({ name, kind, aliases: [name, ...aliases] });
const match = (e: ReturnType<typeof entry>) => matchGenealogyName(e, names)?.name ?? null;

describe("which genealogy name an X-ray entry is (M43 S3)", () => {
  it("takes an exact spelling first, in any case", () => {
    expect(match(entry("Intel", "organisation"))).toBe("Intel");
    expect(match(entry("TEXAS INSTRUMENTS"))).toBe("Texas Instruments");
    expect(match(entry("Bob", "person", ["Robert Noyce"]))).toBe("Robert Noyce");
  });

  it("finds a person by surname, titles left aside, with every other word theirs", () => {
    expect(match(entry("Mr. Utterson", "person", ["Utterson"]))).toBe("Gabriel John Utterson");
    expect(match(entry("Dr. Jekyll"))).toBe("Henry Jekyll");
    expect(match(entry("Noyce", "person"))).toBe("Robert Noyce");
    // A first name alone is not a surname; a wrong first name is not the same person.
    expect(match(entry("Robert", "person"))).toBeNull();
    expect(match(entry("Edward Jekyll", "person"))).toBeNull();
  });

  it("finds an organisation by the words its name begins with, the most linked of several", () => {
    expect(match(entry("Fairchild", "organisation"))).toBe("Fairchild Semiconductor");
    expect(match(entry("Texas", "organisation"))).toBe("Texas Instruments");
    expect(match(entry("Instruments", "organisation"))).toBeNull();
  });

  it("never makes a place, term, work or event a person or company, nor a person a company", () => {
    expect(match(entry("Fairchild", "place"))).toBeNull();
    expect(match(entry("Noyce", "term"))).toBeNull();
    expect(match(entry("Intel", "person"))).toBe("Intel"); // an exact name still holds
    expect(match(entry("Fairchild", "person"))).toBeNull();
  });
});
