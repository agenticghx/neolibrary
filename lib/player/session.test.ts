import { describe, expect, it } from "vitest";
import type { ReadingParagraph } from "@/lib/library/audio";
import { ASK_AGAIN_USD, firstVoice, loadSpeed, madeSoFar, mustAsk, noteFor, playsHere, saveSpeed, shortChapter, SPEED_KEY, speedLabel, usd, withEarlier, withPart, type Info, type NoteState } from "./session";

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
  earlier: null,
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

  it("starts with the voice this paragraph is saved in, so it plays for free (review of #100: a book narrated whole in that voice)", () => {
    const ben = { id: "fake-ben", name: "Ben" };
    const track = { voice: "fake-ben" } as Info["track"];
    expect(firstVoice(info({ voices: [made, ben], track }))).toBe("fake-ben");
    expect(note({ info: info({ voices: [made, ben], track }), voice: "fake-ben" })).toBe("Saved audio: free to play.");
    // The audiobook from near here still comes first; a saved voice no longer on offer is not chosen.
    expect(firstVoice(info({ voices: [book, made, ben], track, audiobook: audiobook() }))).toBe("upload:i1");
    expect(firstVoice(info({ voices: [book, made, ben], track, audiobook: audiobook({ begins: { label: "Chapter 9", nearby: false } }) }))).toBe("fake-ben");
    expect(firstVoice(info({ voices: [made], track }))).toBe("fake-ada");
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
    // A PDF book is read aloud in a made voice as an EPUB is (docs/pdf-narration-plan.md, Part A): the same words.
    expect(note({ info: info({ fileType: "pdf" }) })).toBe("This paragraph costs about $0.04 to read aloud; then it is saved.");
    expect(note({ info: info({ fileType: "pdf", track }) })).toBe("Saved audio: free to play.");
    expect(note({ info: info({ fileType: "pdf", estimate: null }) })).toBe("Reading aloud is not set up yet: the owner needs to add an ElevenLabs key.");
    expect(note({ info: info({ estimate: null }) })).toBe("Reading aloud is not set up yet: the owner needs to add an ElevenLabs key.");
  });

  // Samuel (2026-10-09, "both"): a running total, and a question before paying on past $1.
  it("adds the running total of this listen, says when a paragraph was just paid for, and asks before paying on", () => {
    const track = { voice: "fake-ada" } as Info["track"];
    const made = { count: 2, usd: 1.7 };
    expect(note({ made })).toBe("This paragraph costs about $0.04 to read aloud; then it is saved. This listen: 2 paragraphs made, about $1.70.");
    expect(note({ info: info({ track }), made })).toBe("Saved audio: free to play. This listen: 2 paragraphs made, about $1.70.");
    expect(note({ info: info({ track }), made: { count: 1, usd: 0.85 }, justMade: true })).toBe("Made just now; it plays free from now on. This listen: 1 paragraph made, about $0.85.");
    expect(note({ info: info({ track }), made, ask: 0.85 })).toBe("Keep reading? The next paragraph costs about $0.85. This listen: 2 paragraphs made, about $1.70.");
    // Nothing paid in this listen: the line is as before.
    expect(note({ info: info({ track }), made: { count: 0, usd: 0 } })).toBe("Saved audio: free to play.");
    // The book's own audiobook is free: no total, no question.
    expect(note({ isBook: true, voice: "upload:i1", info: info({ audiobook: audiobook() }), made, ask: 0.85 })).toBe("Your audiobook: free to play.");
    // An error still comes first.
    expect(note({ error: "Stopped.", made, ask: 0.85 })).toBe("Stopped.");
  });

  it("asks once ASK_AGAIN_USD ($1) has been paid since the last go-ahead", () => {
    expect(ASK_AGAIN_USD).toBe(1);
    expect(mustAsk(0)).toBe(false);
    expect(mustAsk(0.85)).toBe(false);
    expect(mustAsk(1)).toBe(true);
    expect(mustAsk(1.7)).toBe(true);
    expect(madeSoFar({ count: 0, usd: 0 })).toBe("");
    expect(madeSoFar({ count: 3, usd: 2.55 })).toBe(" This listen: 3 paragraphs made, about $2.55.");
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

describe("the mini-player's words", () => {
  it("shortens a numbered chapter and keeps a titled one", () => {
    expect(shortChapter("Chapter V")).toBe("Ch. V");
    expect(shortChapter("CHAPTER 12 ")).toBe("Ch. 12");
    expect(shortChapter("Story of the Door")).toBe("Story of the Door");
    expect(shortChapter("")).toBe("");
  });

  it("names speeds as the design does", () => {
    expect([0.75, 1, 1.25, 1.5, 1.75, 2].map(speedLabel)).toEqual(["0.75×", "1.0×", "1.25×", "1.5×", "1.75×", "2.0×"]);
  });
});

describe("withPart", () => {
  it("adds the next part's paragraphs and where the part after it starts, and keeps the chapter names of every part", () => {
    const first = audiobook({ more: 2, chapters: { 0: "Chapter I" } });
    const next = withPart(first, { paragraphs: [{ ...paragraph, sectionId: "s2", chapterIndex: 1, position: 2 }], more: null, chapters: { 1: "Chapter II" } });
    expect(next.paragraphs.map((p) => p.sectionId)).toEqual(["s1", "s2"]);
    expect(next.more).toBeNull();
    expect(next.chapters).toEqual({ 0: "Chapter I", 1: "Chapter II" });
    expect(next.importId).toBe("i1");
  });
});

describe("withEarlier", () => {
  it("adds the part before at the front, says where the part before that ends, and keeps every chapter name and the part after", () => {
    const later = audiobook({ paragraphs: [{ ...paragraph, sectionId: "s5", chapterIndex: 2, position: 5 }], more: 6, earlier: 5, chapters: { 2: "Chapter III" } });
    const part = { paragraphs: [3, 4].map((n) => ({ ...paragraph, sectionId: `s${n}`, chapterIndex: 1, position: n })), earlier: 3, chapters: { 1: "Chapter II" } };
    const both = withEarlier(later, part);
    expect(both.paragraphs.map((p) => p.sectionId)).toEqual(["s3", "s4", "s5"]);
    expect(both.earlier).toBe(3);
    expect(both.more).toBe(6);
    expect(both.chapters).toEqual({ 1: "Chapter II", 2: "Chapter III" });
    expect(both.importId).toBe("i1");
    // The first part of the audiobook: nothing before it any more.
    expect(withEarlier(both, { paragraphs: [{ ...paragraph, position: 1 }], earlier: null, chapters: {} }).earlier).toBeNull();
  });
});

describe("playsHere", () => {
  it("plays on Home only an audiobook with something from the reading position on, going on from near it", () => {
    expect(playsHere({ audiobook: audiobook() })).toBe(true);
    expect(playsHere({ audiobook: audiobook({ begins: { label: "Chapter II", nearby: true } }) })).toBe(true);
    // It ends before the reading position: the reader says so, with Play off.
    expect(playsHere({ audiobook: audiobook({ paragraphs: [] }) })).toBe(false);
    // It begins further on: the reader says where, and waits.
    expect(playsHere({ audiobook: audiobook({ begins: { label: "Chapter IX", nearby: false } }) })).toBe(false);
    expect(playsHere({ audiobook: null })).toBe(false);
    expect(playsHere(null)).toBe(false);
  });
});
