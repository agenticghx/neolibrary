import { describe, expect, it } from "vitest";
import { normaliseAlias, tidyAliases } from "./xray-aliases";

/** The rules on what Chip War's reading produced (M32 X7, 2026-10-23): each case stands for one row seen on the live site. */
describe("alias hygiene (M32 X7)", () => {
  it("writes an alias one way: no quotes, no trailing punctuation, no leading 'the', no possessive", () => {
    expect(["“chip,”", "“chips.”", "Intel’s", "the Pentagon", "The Pentagon’s", "(EUV)", " Bob  Noyce "].map(normaliseAlias)).toEqual(["chip", "chips", "Intel", "Pentagon", "Pentagon", "EUV", "Bob Noyce"]);
  });

  it("keeps the ways of writing a name and drops common words, demonyms, descriptions and other entries' names", () => {
    // "chip" is the book's subject, not a way of writing "integrated circuit": 832 mentions became the real ones.
    expect(tidyAliases("integrated circuit", ["integrated circuit", "Chip", "integrated circuits", "“integrated circuits”", "“integrated circuit,”", "chip", "chips", "“chip,”", "“chips.”"], [])).toEqual(["integrated circuit", "Chip", "integrated circuits"]);
    // Japan is an entry of its own; "Japanese" is an adjective.
    expect(tidyAliases("Tokyo", ["Tokyo", "Japan", "Japan’s", "Japanese"], ["Japan", "China"])).toEqual(["Tokyo"]);
    // Descriptions add lower-case words to the name; a fuller name adds capitals.
    expect(tidyAliases("TSMC", ["TSMC", "Taiwan Semiconductor Manufacturing Company", "TSMC’s", "Taiwan’s TSMC", "TSMC knows", "TSMC’s chairman"], ["Taiwan"])).toEqual(["TSMC", "Taiwan Semiconductor Manufacturing Company", "Taiwan’s TSMC"]);
    expect(tidyAliases("Taiwan", ["Taiwan", "the island of Taiwan", "Taiwanese", "the island", "Taiwan’s"], [])).toEqual(["Taiwan"]);
    expect(tidyAliases("Morris Chang", ["Morris Chang", "Chang", "Chang’s", "Morris Chang’s"], [])).toEqual(["Morris Chang", "Chang"]);
    expect(tidyAliases("Robert Noyce", ["Robert Noyce", "Bob Noyce", "Noyce"], [])).toEqual(["Robert Noyce", "Bob Noyce", "Noyce"]);
    expect(tidyAliases("Soviet Union", ["Soviet Union", "Soviets", "Soviet", "Russians", "USSR", "the USSR", "Soviet military"], [])).toEqual(["Soviet Union", "USSR"]);
    // Plurals, compounds and an acronym's words are ways of writing the name.
    expect(tidyAliases("DRAM", ["DRAM", "dynamic random access memory", "DRAM chips", "DRAMs", "DRAM business"], [])).toEqual(["DRAM", "dynamic random access memory", "DRAMs"]);
    expect(tidyAliases("photolithography", ["photolithography", "lithography", "lithography machines", "lithographic", "Lithography"], [])).toEqual(["photolithography", "lithography", "lithographic"]);
    expect(tidyAliases("fab", ["fab", "fabs", "chip fab"], [])).toEqual(["fab", "fabs"]);
    expect(tidyAliases("transistor", ["transistor", "transistors", "the transistor", "discrete transistors", "transistor radio"], [])).toEqual(["transistor", "transistors"]);
    // The name is always kept, whatever it looks like; an alias equal to it adds nothing.
    expect(tidyAliases("extreme ultraviolet (EUV) light", ["EUV", "extreme ultraviolet", "EUV lithography", "Extreme Ultraviolet (EUV) Light"], [])).toEqual(["extreme ultraviolet (EUV) light", "EUV", "extreme ultraviolet"]);
    expect(tidyAliases("Johannes Gutenberg", ["Gutenberg", "Gutenberg’s"], ["Gutenberg moment"])).toEqual(["Johannes Gutenberg", "Gutenberg"]);
  });
});
