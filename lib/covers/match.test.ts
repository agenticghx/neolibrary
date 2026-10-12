import { describe, expect, it } from "vitest";
import { isMatch, normalize, shortTitle, surnameOf } from "./match";

// Cases from the probe of Hidden Machinery's 101 titles against Open Library (2026-10-11).
describe("matching a catalogue record to a title", () => {
  it("normalizes accents, apostrophes, ampersands and punctuation", () => {
    expect(normalize("Einstein's Clocks, Poincaré's Maps")).toBe("einsteins clocks poincares maps");
    expect(normalize("Leibbrandt & de Terán")).toBe("leibbrandt and de teran");
    expect(normalize("  Rubbish!  ")).toBe("rubbish");
  });

  it("takes the title before its subtitle", () => {
    expect(shortTitle("Thinking in Systems: A Primer")).toBe("Thinking in Systems");
    expect(shortTitle("Rust: The Longest War")).toBe("Rust");
    expect(shortTitle("Meditations on First Philosophy (Oxford World's Classics)")).toBe("Meditations on First Philosophy");
    expect(shortTitle("The Grid")).toBe("The Grid");
  });

  it("searches by the first author's surname, without Jr. or initials", () => {
    expect(surnameOf("Bakke")).toBe("Bakke");
    expect(surnameOf("Leibbrandt & de Terán")).toBe("Leibbrandt");
    expect(surnameOf("Thomas Petzinger Jr.")).toBe("Petzinger");
    expect(surnameOf("Donella Meadows")).toBe("Meadows");
    expect(surnameOf("J. R. R. Tolkien")).toBe("Tolkien");
    expect(surnameOf("Blas and Farchy")).toBe("Blas");
    expect(surnameOf("")).toBe("");
  });

  it("matches the same book under a catalogue's spelling of it", () => {
    const grid = { title: "The Grid", author: "Bakke" };
    expect(isMatch(grid, { title: "The grid", authors: ["Gretchen Anna Bakke"] })).toBe(true);
    expect(isMatch(grid, { title: "Grid, The", authors: ["Gretchen Anna Bakke", "Emily Caudwell"] })).toBe(true);
    expect(isMatch({ title: "Thinking in Systems: A Primer", author: "Donella Meadows" }, { title: "Thinking in systems", authors: ["Donella H. Meadows"] })).toBe(true);
    expect(isMatch({ title: "Chip War", author: "Miller" }, { title: "Chip War: The Fight for the World's Most Critical Technology", authors: ["Chris Miller"] })).toBe(true);
    expect(isMatch({ title: "Einstein's Clocks, Poincaré's Maps", author: "Galison" }, { title: "Einstein's Clocks, Poincare's Maps", authors: ["Peter Galison"] })).toBe(true);
  });

  it("refuses another book: a different title, or the same title by someone else", () => {
    const grid = { title: "The Grid", author: "Bakke" };
    expect(isMatch(grid, { title: "The Grid", authors: ["Philip Kerr"] })).toBe(false);
    expect(isMatch(grid, { title: "Gridlock", authors: ["Gretchen Bakke"] })).toBe(false);
    expect(isMatch({ title: "Tubes", author: "Blum" }, { title: "Tubes and Pipes", authors: ["Andrew Blum"] })).toBe(false);
    expect(isMatch(grid, { title: "", authors: ["Bakke"] })).toBe(false);
  });

  it("takes a subtitle run on without punctuation, refuses a bundle, and never counts a first name as the surname", () => {
    expect(isMatch({ title: "Ninety Percent of Everything", author: "George" }, { title: "Ninety Percent Of Everything Inside Shipping The Invisible Industry That Puts Clothes On Your Back", authors: ["Rose George", "Pearl Hewitt"] })).toBe(true);
    expect(isMatch({ title: "The World for Sale", author: "Blas & Farchy" }, { title: "The World for Sale By Javier Blas, Jack Farchy & The Rare Metals War By Guillaume Pitron 2 Books Collection Set", authors: ["Javier Blas & Jack Farchy"] })).toBe(false);
    expect(isMatch({ title: "Money: The Unauthorized Biography", author: "Felix Martin" }, { title: "Money", authors: ["Martin Amis"] })).toBe(false);
    expect(isMatch({ title: "Money: The Unauthorized Biography", author: "Felix Martin" }, { title: "Money", authors: ["Felix Martin"] })).toBe(true);
    expect(isMatch({ title: "Double Entry", author: "Gleeson-White" }, { title: "Double Entry", authors: ["Jane Gleeson-White"] })).toBe(true);
    expect(isMatch({ title: "The World for Sale", author: "Blas & Farchy" }, { title: "The World for Sale", authors: ["Javier Blas & Jack Farchy"] })).toBe(true);
    expect(isMatch({ title: "The Grid", author: "Bakke" }, { title: "The Grid", authors: ["Bakke, Gretchen"] })).toBe(true);
    expect(isMatch({ title: "Beyond Measure", author: "Vincent" }, { title: "Beyond Measure", authors: ["VINCENT J"] })).toBe(true);
  });

  it("without an author, needs the whole title", () => {
    expect(isMatch({ title: "Normal Accidents", author: "" }, { title: "Normal Accidents", authors: ["Charles Perrow"] })).toBe(true);
    expect(isMatch({ title: "Normal Accidents", author: "" }, { title: "Normal Accidents: Living with High-Risk Technologies", authors: ["Charles Perrow"] })).toBe(true);
    expect(isMatch({ title: "Normal", author: "" }, { title: "Normal Accidents", authors: ["Charles Perrow"] })).toBe(false);
  });
});
