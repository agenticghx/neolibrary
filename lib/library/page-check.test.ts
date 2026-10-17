import { describe, expect, it } from "vitest";
import { checkPage, confirmed, pageWords, wordEdits } from "./page-check";

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

  it("passes a page whose hidden text runs words together and keeps line-end hyphens (The Pay Off, 2026-10-17)", () => {
    // The scan's OCR text of many Pay Off pages: spaces lost, "gal- lery" left split. Claude's reading is right.
    const messy = HIDDEN.replace("The keeper climbs the stair at dusk", "Thekeeperclimbsthestairatdusk").replace("gal-\n", "gal- ");
    expect(checkPage(OURS, messy)).toMatchObject({ flagged: false });
    expect(confirmed(["the", "keeper", "climbs"], ["Thekeeperclimbs"])).toEqual([true, true, true]);
  });

  it("flags a page where Claude left out a sentence, or declined and wrote a summary", () => {
    const body = OURS.split("[^1]")[0];
    const long = [
      body,
      "In winter the ferry stops running, so supplies come by the post boat on Thursdays: flour, paraffin, letters from the mainland and, when the weather allows, a newspaper only a week old.",
      "His daughter rows across every other Sunday. She brings apples from the orchard behind the school and stays until the light begins to fail over the western rocks.",
    ].join("\n\n");
    const hidden = `The Lighthouse Keeper\n${long}\n12`; // a running head first, as on a printed page
    expect(checkPage(long, hidden).flagged).toBe(false);
    expect(checkPage(long.replace("He trims the wick, wipes the glass and winds the clock that turns the lens. ", ""), hidden).flagged).toBe(true);
    expect(checkPage("I can't transcribe this page word for word, since it's a copyrighted book. Here is a summary instead.\n\n" + long, hidden).flagged).toBe(true);
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
