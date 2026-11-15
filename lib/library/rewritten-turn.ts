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

/** Whether $1 or more has been paid since the last go-ahead. */
export const mustAskAgain = (sinceOkUsd: number) => mustAsk(sinceOkUsd);

/** A millionth of a cent, so that paying 0.33 + 0.56 + 0.11 (1.0000000000000002 in floating point) counts as $1. */
const SLACK_USD = 1e-8;

/**
 * Whether the next paragraph may be paid for without asking "Keep rewriting?" first, at its
 * estimated price (the one the pane shows). Only if the total since the last go-ahead stays
 * within ASK_AGAIN_USD with it (Samuel, 2026-11-15, finding 8 of the verify-spending check:
 * before, it asked only once $1 had been paid, so two 60-cent paragraphs made $1.20). One
 * exception, `justAsked`: the first paragraph of the loop the reader's own press started, whose
 * price was on that button's line; without it a paragraph that alone costs more than $1 could
 * never be written. The rule holds only while a paragraph costs no more than its estimate.
 */
export const mayPay = (sinceOkUsd: number, estimateUsd: number, justAsked: boolean) =>
  justAsked || sinceOkUsd + estimateUsd <= ASK_AGAIN_USD + SLACK_USD;

/**
 * The as-you-turn state of one visit, kept by the reader (Reader.tsx), so that it outlives the
 * Rewritten pane. It is changed at once, not when React next renders: a page that arrives
 * straight after a paid paragraph sees its cost (finding 9), and a loop started by a pane that
 * was then closed is still counted, still stopped by Stop, and not doubled by the pane opened
 * after it (finding 10). The pane renders from it with useSyncExternalStore.
 */
export type TurnStore = {
  get: () => AsYouTurn;
  change: (f: (t: AsYouTurn) => AsYouTurn) => void;
  subscribe: (listener: () => void) => () => void;
  /** A rewriting loop starts: false if one runs already, in the open pane or in one that was closed (one at a time). */
  begin: () => boolean;
  /** The loop ended: the next may start, and the open pane's goOn is told (`by`: the pane whose loop it was, `at`: its place). */
  end: (ended: Ended) => void;
  /** Sets the open pane's goOn; returns what removes it again. */
  onEnd: (goOn: (ended: Ended) => void) => () => void;
};

type Ended = { by: object; at: string };

export function turnStore(): TurnStore {
  let turn = TURN_OFF;
  const listeners = new Set<() => void>();
  let running = false;
  let wake: ((ended: Ended) => void) | null = null;
  return {
    get: () => turn,
    change: (f) => {
      turn = f(turn);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin: () => {
      if (running) return false;
      running = true;
      return true;
    },
    end: (ended) => {
      running = false;
      wake?.(ended);
    },
    onEnd: (goOn) => {
      wake = goOn;
      return () => {
        if (wake === goOn) wake = null;
      };
    },
  };
}

/** The running total: " So far: 3 paragraphs rewritten, about $0.06." (nothing when none). */
export const soFar = (t: AsYouTurn) =>
  t.count ? ` So far: ${t.count} ${t.count === 1 ? "paragraph" : "paragraphs"} rewritten, ${usd(t.usd)}.` : "";

export { ASK_AGAIN_USD, usd };
