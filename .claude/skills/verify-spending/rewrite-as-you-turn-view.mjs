// The words for the chart of RewriteAsYouTurn.tla (the statechart skill reads this "view").
// Written for: whoever reads the chart, in the reader's own words.
const loops = (v) => Object.values(v.loop).filter((l) => l.pc !== "idle");
const asksAt = 100; // ASK_AGAIN_USD in cents, as in the configs

export const title = "Rewrite as you turn";

export const state = (v) => {
  const running = loops(v);
  if (running.some((l) => l.pc === "posting")) return "The AI is rewriting a paragraph";
  if (running.length) return "Rewriting the page on screen";
  if (!v.turn.on) return "Off: the price is shown";
  if (v.turn.since >= asksAt) return "$1 paid: it asks before paying more";
  return "On: waiting for the next page";
};

export const group = (v) => {
  const s = state(v);
  if (s === "The AI is rewriting a paragraph") return "The AI is paid";
  if (s === "$1 paid: it asks before paying more") return "It asks before paying more";
  if (s === "Off: the price is shown") return "Rewriting is off";
  return "Rewriting is on";
};

export const colors = {
  "Rewriting is off": "tan",
  "Rewriting is on": "blue",
  "The AI is paid": "orange",
  "It asks before paying more": "purple",
};

export const step = (action, from, to) => {
  switch (action) {
    case "YouTurnThePage":
      return "you turn the page";
    case "YouAskForARewrite":
      return "you ask for a rewrite";
    case "YouPressKeepRewriting":
      return "you press Keep rewriting";
    case "YouPressStop":
      return "you press Stop";
    case "YouSwitchToOriginal":
      return "you switch to Original";
    case "YouOpenSideBySide":
      return "you open Side by side";
    case "TheRewriteViewArrives":
      return "the page arrives";
    case "TheLoopDecides": {
      if (loops(to).some((l) => l.pc === "posting")) return "the next paragraph is sent to the AI";
      const was = loops(from).find((l) => l.pc === "deciding");
      if (loops(to).length >= loops(from).length) return "it goes on with the page now on screen";
      if (was && !from.ref[was.pane].on) return "it stops: you pressed Stop";
      if (was && was.since >= asksAt) return "it stops: $1 paid since you said go ahead";
      if (was && from.place[was.pane] !== was.at) return "it stops: you turned the page";
      return "the page is done";
    }
    case "ThePostAnswers":
      return "the AI is paid; the rewrite shows";
    case "ThePostFails":
      return "the limit is reached, or the call fails";
    case "YouReachTheLastPage":
      return null;
    case "TheScreenCatchesUp":
      return "the screen catches up";
    default:
      return action;
  }
};
