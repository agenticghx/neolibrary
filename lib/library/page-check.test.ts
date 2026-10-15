import { describe, expect, it } from "vitest";
import { checkPage, pageWords, wordEdits } from "./page-check";

// Invented text, laid out as a scan's OCR text (lines, a running head, a page number) and as Claude's Markdown.
const HIDDEN = `The Lighthouse Keeper
The keeper climbs the stair at dusk and lights the lamp. He trims the wick,
wipes the glass and winds the clock that turns the lens. From the gal-
lery he can see the harbour, the quay and the boats coming home before
the tide turns, and he writes each one in the log.1
1 The log is kept in the lamp room.
12`;
const OURS = `The keeper climbs the stair at dusk and lights the lamp. He trims the wick, wipes the glass and winds the clock that turns the lens. From the gallery he can see the harbour, the quay and the boats coming home before the tide turns, and he writes each one in the log.[^1]

[^1]: The log is kept in the lamp room.`;

describe("the page check", () => {
  it("tidies both readings alike: broken words joined, Markdown and footnote marks dropped", () => {
    expect(pageWords("From the gal-\nlery, *quietly*.[^1]")).toEqual(["From", "the", "gallery", "quietly"]);
    expect(pageWords("## Liquidity\n‘Here,’ he said – twice.")).toEqual(["Liquidity", "Here", "he", "said", "-", "twice"].filter((w) => w !== "-"));
  });

  it("counts word changes", () => {
    expect(wordEdits(["a", "b", "c"], ["a", "x", "c", "d"])).toBe(2);
    expect(wordEdits([], ["a"])).toBe(1);
  });

  it("passes a page whose two readings differ only by the running head, page number and a footnote", () => {
    const r = checkPage(OURS, HIDDEN);
    expect(r.agreement).toBeGreaterThan(0.9);
    expect(r.flagged).toBe(false);
  });

  it("passes the same text, and flags a page where Claude's words are not the scan's", () => {
    const body = OURS.split("[^1]")[0];
    expect(checkPage(body, body)).toEqual({ agreement: 1, flagged: false });
    const reworded = body.replace("climbs the stair at dusk and lights the lamp", "goes up at nightfall to light the lantern");
    expect(checkPage(reworded, body).flagged).toBe(true);
  });

  it("flags a page whose hidden text is gibberish (a sideways table read upside down)", () => {
    const gibberish = Array.from({ length: 40 }, (_, i) => ["Jooyps", "Apauusy", "preareyy", "Buppioyy"][i % 4]).join("\n");
    expect(checkPage(OURS, gibberish)).toMatchObject({ flagged: true });
  });

  it("has nothing to compare when the hidden text is nearly empty, and flags only a page where Claude found words", () => {
    expect(checkPage(OURS, "12")).toEqual({ agreement: null, flagged: true });
    expect(checkPage("", "")).toEqual({ agreement: null, flagged: false });
  });
});
