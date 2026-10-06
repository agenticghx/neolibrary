import { describe, expect, it } from "vitest";
import type { ReadingParagraph } from "@/lib/library/audio";
import { firstVoice, loadSpeed, noteFor, saveSpeed, SPEED_KEY, usd, type Info, type NoteState } from "./session";

const paragraph: ReadingParagraph = { sectionId: "s1", cfi: "epubcfi(/6/2)", chapterIndex: 0, position: 1, text: "Once.", file: 0, startMs: 0, endMs: 1000, words: [[0, 500, 0, 4]] };
const audiobook = (over: Partial<NonNullable<Info["audiobook"]>> = {}): NonNullable<Info["audiobook"]> => ({
  paragraphs: [paragraph],
  more: null,
  importId: "i1",
  voice: "upload:i1",
  title: "My reading",
  files: [{ url: "/a/0", mime: "audio/mpeg" }],
  partsUrl: "/parts",
  chapters: {},
  begins: null,
  ...over,
});
const made = { id: "fake-ada", name: "Ada" };
const book = { id: "upload:i1", name: "Your audiobook" };
const info = (over: Partial<Info> = {}): Info => ({
  passage: { id: "s1", cfi: "epubcfi(/6/2)", position: 1, nextId: null, prevId: null, characters: 5, text: "Once.", chapter: "" },
  book: { title: "A book", author: "Someone" },
  voices: [book, made],
  track: null,
  estimate: 0.04,
  audiobook: null,
  fileType: "epub",
  ...over,
});
const note = (over: Partial<NoteState> = {}) =>
  noteFor({ error: null, info: info(), isBook: false, voice: "fake-ada", bookEnded: false, loading: false, bookStarted: false, ...over });

describe("firstVoice", () => {
  it("starts with the audiobook when it goes on from near here", () => {
    expect(firstVoice(info({ audiobook: audiobook() }))).toBe("upload:i1");
    expect(firstVoice(info({ audiobook: audiobook({ begins: { label: "Chapter 3", nearby: true } }) }))).toBe("upload:i1");
  });

  it("starts with a made voice when the audiobook begins further on", () => {
    expect(firstVoice(info({ audiobook: audiobook({ begins: { label: "Chapter 9", nearby: false } }) }))).toBe("fake-ada");
  });

  it("starts with the audiobook further on when nothing else can read aloud", () => {
    expect(firstVoice(info({ voices: [book], audiobook: audiobook({ begins: { label: "Chapter 9", nearby: false } }) }))).toBe("upload:i1");
  });

  it("starts with a made voice when the audiobook has nothing from here on", () => {
    expect(firstVoice(info({ audiobook: audiobook({ paragraphs: [] }) }))).toBe("fake-ada");
  });

  it("starts with the first voice, or none", () => {
    expect(firstVoice(info({ voices: [made, { id: "fake-ben", name: "Ben" }] }))).toBe("fake-ada");
    expect(firstVoice(info({ voices: [] }))).toBe("");
  });
});

describe("noteFor", () => {
  it("says an error first, and that it is finding the place until it has it", () => {
    expect(note({ error: "Reading aloud could not start." })).toBe("Reading aloud could not start.");
    expect(note({ info: null })).toBe("Finding where you are…");
  });

  it("speaks of the audiobook in its own words", () => {
    const isBook = { isBook: true, voice: "upload:i1" };
    expect(note({ ...isBook, info: info({ audiobook: audiobook({ paragraphs: [] }) }) })).toBe("Your audiobook ends before this part of the book.");
    expect(note({ ...isBook, info: info({ audiobook: audiobook() }), bookEnded: true })).toBe("That is the end of your audiobook.");
    expect(note({ ...isBook, info: info({ audiobook: audiobook() }), loading: true })).toBe("Loading your audiobook…");
    const further = info({ audiobook: audiobook({ begins: { label: "Chapter 9", nearby: false } }) });
    expect(note({ ...isBook, info: further })).toBe("Your audiobook begins further on (Chapter 9): Play turns to it.");
    expect(note({ ...isBook, info: further, bookStarted: true })).toBe("Your audiobook: free to play.");
    expect(note({ ...isBook, info: info({ audiobook: audiobook() }) })).toBe("Your audiobook: free to play.");
  });

  it("explains a made voice's cost, a saved track, a PDF and a missing key", () => {
    expect(note()).toBe("This paragraph costs about $0.04 to read aloud; then it is saved.");
    expect(note({ info: info({ estimate: 0.004 }) })).toBe("This paragraph costs under $0.01 to read aloud; then it is saved.");
    const track = { voice: "fake-ada" } as Info["track"];
    expect(note({ info: info({ track }) })).toBe("Saved audio: free to play.");
    expect(note({ info: info({ track }), voice: "fake-ben" })).toBe("This paragraph costs about $0.04 to read aloud; then it is saved.");
    expect(note({ info: info({ fileType: "pdf" }) })).toBe("In a PDF book, Listen plays your own audiobook: add one on the book's page.");
    expect(note({ info: info({ estimate: null }) })).toBe("Reading aloud is not set up yet: the owner needs to add an ElevenLabs key.");
  });

  it("rounds money as the bar shows it", () => {
    expect(usd(0.009)).toBe("under $0.01");
    expect(usd(0.01)).toBe("about $0.01");
    expect(usd(1.234)).toBe("about $1.23");
  });
});

describe("the speed kept on this device", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it("starts at 1, then at the speed chosen last", () => {
    const s = store();
    expect(loadSpeed(s)).toBe(1);
    saveSpeed(1.75, s);
    expect(s.m.get(SPEED_KEY)).toBe("1.75");
    expect(loadSpeed(s)).toBe(1.75);
  });

  it("ignores a speed it does not offer, and a browser that keeps nothing", () => {
    const s = store();
    s.m.set(SPEED_KEY, "3");
    expect(loadSpeed(s)).toBe(1);
    s.m.set(SPEED_KEY, "fast");
    expect(loadSpeed(s)).toBe(1);
    const refusing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(loadSpeed(refusing)).toBe(1);
    expect(() => saveSpeed(1.5, refusing)).not.toThrow();
    expect(loadSpeed(null)).toBe(1);
  });
});
