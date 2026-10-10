import { ASK_AGAIN_USD, mustAsk, usd } from "@/lib/player/session";

/**
 * Read it rewritten as you turn (M17 R3, docs/rewritten-view-plan.md). After
 * the reader's first "Rewrite this page", each page turned to is rewritten
 * too, with a running total, until Stop, a failure, or leaving the reader.
 * As with Listen (#133), once ASK_AGAIN_USD has been paid since the last
 * go-ahead it stops and asks "Keep rewriting?" before paying for more. The
 * go-ahead is never remembered on the device: each visit starts off.
 */
export type AsYouTurn = {
  /** Rewriting each page as it is turned to. */
  on: boolean;
  /** Paragraphs paid for in this visit, and their cost in US dollars. */
  count: number;
  usd: number;
  /** Paid since the last go-ahead ("Rewrite this page" or "Keep rewriting"). */
  sinceOk: number;
};

export const TURN_OFF: AsYouTurn = { on: false, count: 0, usd: 0, sinceOk: 0 };

/** The reader's go-ahead: on, and the count towards the next question starts again. */
export const goAhead = (t: AsYouTurn): AsYouTurn => ({ ...t, on: true, sinceOk: 0 });

/** One paragraph paid for (a saved rewrite served again costs nothing and is not counted). */
export const paidFor = (t: AsYouTurn, costUsd: number): AsYouTurn => ({ ...t, count: t.count + 1, usd: t.usd + costUsd, sinceOk: t.sinceOk + costUsd });

/** Whether it must ask before paying for another paragraph. */
export const mustAskAgain = (sinceOkUsd: number) => mustAsk(sinceOkUsd);

/** The running total: " So far: 3 paragraphs rewritten, about $0.06." (nothing when none). */
export const soFar = (t: AsYouTurn) =>
  t.count ? ` So far: ${t.count} ${t.count === 1 ? "paragraph" : "paragraphs"} rewritten, ${usd(t.usd)}.` : "";

export { ASK_AGAIN_USD, usd };
