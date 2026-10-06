import type { SlotKind } from "@/data/paths/types";

/*
 * The words a Path you made uses (M14 step 5, D10). A built-in reading list
 * (Hidden Machinery) keeps its own: pillars, N and E, the master key. No
 * server imports here: the forms that use these words run in the browser.
 */

/** How to read a title in your own Path. Stored as N / E / extra; "master" is the reading list's only. */
export const KIND_WORDS: Record<SlotKind, string> = { N: "Story first", E: "Go deeper", extra: "Any order", master: "Read last" };

/** The choices under "How to read it" (no "Read last": D10). */
export const KIND_CHOICES = (["N", "E", "extra"] as const).map((value) => ({ value, label: KIND_WORDS[value] }));

/** What a Path's parts are called: a reading list has pillars, your own Path has sections. */
export const partsWord = (readingList: boolean, n: number) => (readingList ? (n === 1 ? "pillar" : "pillars") : n === 1 ? "section" : "sections");
