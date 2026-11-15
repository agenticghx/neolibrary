// Labels for the narration model (Narration.tla), in the owner's words, for the /pstack:statechart skill.
// Written for Samuel, who reads the chart and the bug paths: each state is what the Import page and the Listen bar
// would show, each arrow is something you do or something that happens to the site. Hidden: a restart while no run
// is going on (see step()).

const list = (o) => Object.values(o ?? {});
const ENDED = new Set([
  "finished",
  "stopped",
  "month limit",
  "book limit",
  "error",
]);
const running = (r) => !ENDED.has(r.pc);

const ENDINGS = {
  finished: "done: every paragraph is saved",
  stopped: "stopped, as you asked",
  "month limit": "stopped by the monthly limit",
  "book limit": "stopped by the book's limit",
  error: "stopped by an error",
};

function runWords(r) {
  if (running(r) && r.stop)
    return "stopping: the paragraph being made finishes";
  switch (r.pc) {
    case "loading":
      return "starting: reading which paragraphs are saved";
    case "passage":
    case "lookup":
    case "reserve":
      return `making paragraph ${r.at}: not paid for yet`;
    case "calling":
      return `making paragraph ${r.at}: paid for, the voice is reading it`;
    case "saving":
      return `making paragraph ${r.at}: saving the audio paid for earlier`;
    case "joined":
      return `making paragraph ${r.at}: waiting for the Listen bar's copy`;
    default:
      return ENDINGS[r.pc];
  }
}

function listenWords(l) {
  switch (l.pc) {
    case "passage":
    case "lookup":
    case "reserve":
      return `Listen bar asks for paragraph ${l.at}, not paid for yet`;
    case "calling":
      return `Listen bar paid for paragraph ${l.at}, the voice is reading it`;
    case "saving":
      return `Listen bar saves paragraph ${l.at}, paid for earlier`;
    case "joined":
      return `Listen bar waits for the run's paragraph ${l.at}`;
    default:
      return null;
  }
}

const capital = (s) => s[0].toUpperCase() + s.slice(1);

export const title = "Whole-book narration";

export const state = (v) => {
  const books = Object.keys(v.spent ?? {}).length;
  const runs = list(v.runs);
  // What the Import page shows: the run going on (or the last one, per book); a run left on an old server is named so.
  const shown = runs.filter((r) => r.inMap || running(r));
  const parts = shown.map((r) => {
    const where = r.srv < v.server ? "old server, " : "";
    const book = books > 1 || where ? `${where}${r.book}: ` : "";
    return book + runWords(r);
  });
  if (!parts.length)
    parts.push(
      v.server > 1
        ? "nothing going on: the site restarted"
        : "nothing going on",
    );
  const l = listenWords(v.listen);
  if (l) parts.push(l);
  if (v.old === "overlap") parts.push("the old server runs on");
  if (v.old === "draining") parts.push("the old server finishes its paragraph");
  return capital(parts.join("; "));
};

const total = (o) => list(o).reduce((n, x) => n + x, 0);
const pcs = (v) => list(v.runs).map((r) => r.pc);
const count = (v, pc) => pcs(v).filter((p) => p === pc).length;
const limitIn = (from, to) =>
  ["month limit", "book limit"].find((k) => count(to, k) > count(from, k));

export const step = (action, from, to) => {
  switch (action) {
    case "YouPressCreate":
      return "you tick the cost box and press Create";
    case "YouPressStop":
      return "you press Stop";
    case "RunReadsSaved":
      return "the run reads which paragraphs are saved";
    case "RunJoins":
    case "ListenJoins":
      return null; // the in-flight look after passageFor: drawn as part of the next step
    case "RunLooksUp":
      if (count(to, "saving") > count(from, "saving")) return "audio paid for earlier is saved now";
      return count(to, "reserve") > count(from, "reserve")
        ? "the paragraph is not saved yet"
        : "the paragraph is saved already, so it is skipped";
    case "RunPays":
    case "ListenPays": {
      const who = action === "RunPays" ? "the run" : "the Listen bar";
      if (total(to.money) > total(from.money))
        return action === "RunPays"
          ? "a paragraph is paid for"
          : "the Listen bar pays for its paragraph";
      const limit = limitIn(from, to);
      if (limit === "book limit") return "the book's limit is reached";
      if (limit === "month limit") return "the monthly limit is reached";
      return `a spending limit stops ${who}`;
    }
    case "RunSaves":
      return "the paragraph is saved";
    case "RunSaveFails":
      return "saving the paid paragraph fails";
    case "YouPressListen":
      return "you press Listen on a paragraph";
    case "ListenLooksUp":
      return "the Listen bar looks for a saved copy";
    case "ListenSaves":
      return "the Listen bar's paragraph is saved";
    case "ListenSaveFails":
      return "saving the Listen bar's paid paragraph fails";
    case "TheSiteRestarts":
      // A restart with no run going on changes nothing a reader sees: not drawn (to keep the chart readable).
      return list(from.runs).some(running) ? "the site restarts" : null;
    case "TheOldServerGetsSigterm":
      return "the old server is told to stop";
    case "TheOldServerExits":
      return "the old server stops";
    case "TheOldServerIsKilled":
      return "the old server is ended mid-paragraph";
    default:
      return action;
  }
};

export const group = (v) => {
  const runs = list(v.runs);
  if (runs.some(running)) return "going";
  if (runs.length) return "ended";
  return "idle";
};

export const colors = { going: "teal", ended: "tan", idle: "blue" };
