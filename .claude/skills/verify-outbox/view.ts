// The chart's words for Outbox.tla, for the /pstack:statechart skill (see SKILL.md). Not part of the app.
// Flow.cfg (one tab) is drawn as two regions: the network and the note you write.
// Outbox.cfg and Readers.cfg (two tabs) add who is signed in, the second tab, and the note the library already has.

type Item = { id: number; op: string; note: string; owner: string; seq: number; at: number; refused: boolean };
type Note = { state: string; words: number };
type Want = { state: string; words: number; pseq: number; last: string };
type Flush = { pc: string; todo: Record<string, Item> | Item[]; cur: Item; st: number; as: string };
type Vars = {
  net: string;
  session: string;
  page: Record<string, string>;
  box: Record<string, Item> | Item[];
  fl: Record<string, Flush>;
  ui: { act: string; op: string; note: string; behind: boolean };
  offer: { kind: string };
  srv: Record<string, Note>;
  want: Record<string, Want>;
  flags: Record<string, boolean>;
};

const items = (v: Vars) => Object.values(v.box ?? {});
const twoTabs = (v: Vars) => Object.keys(v.fl).length > 1;
const yours = (i: Item) => i.owner === "A" || i.owner === "none";
const NAME: Record<string, string> = { n: "your new note", s: "your saved note" };

/** Where one note stands, as the reader would put it. */
function noteLabel(v: Vars, x: string): string {
  const lib = v.srv[x];
  const want = v.want[x];
  const here = items(v).filter((i) => i.note === x);
  const mine = here.filter(yours);
  const carries = (seq: number) => mine.some((i) => i.seq === seq);
  if (want.state === "none") return x === "n" ? "Not written yet" : "None";
  let label: string;
  if (want.state === "gone") {
    if (lib.state !== "live") label = mine.some((i) => i.op === "remove" && !i.refused) ? "Removed; a copy of the removal still waits here" : "Removed";
    else label = carries(want.pseq) ? "Removed here; the removal waits on this device" : "Removed here, but the library still has it";
  } else {
    const there = lib.state === "live";
    const sameWords = lib.words === want.words;
    if (!there && !carries(want.pseq)) label = lib.state === "gone" ? "Brought back here, but the library has it removed" : "Gone from both";
    else if (!sameWords && !carries(want.words)) label = v.flags.older ? "An older edit replaced your newer words" : "Your new words are lost";
    else if (there && sameWords) label = mine.length ? "On the library; a copy still waits here" : "Saved on the library";
    else label = there ? "Library has the old words; the new words wait here" : "Waits on this device";
  }
  if (mine.some((i) => i.refused)) label += "; a change is kept as 'Could not be saved'";
  if (here.some((i) => !yours(i))) label += "; a change of yours now carries another reader's name";
  return label;
}

const signedIn = (v: Vars) => (v.session === "A" ? "As you" : v.session === "B" ? "As another reader" : "Nobody");
const secondTab = (v: Vars) => (v.page.t2 === "A" ? "Yours" : v.page.t2 === "B" ? "Another reader's" : "Closed");

export const title = "A note you write offline, and what the outbox does with it";

export function state(v: Vars) {
  const network = v.net === "up" ? "Online" : "Offline";
  if (!twoTabs(v)) return { Network: network, "Your new note": noteLabel(v, "n") };
  return {
    Network: network,
    "Signed in": signedIn(v),
    "Second tab": secondTab(v),
    "Your new note": noteLabel(v, "n"),
    "Your saved note": noteLabel(v, "s"),
  };
}

/** The tab whose flush changed in this step. */
function tabOf(from: Vars, to: Vars): string {
  for (const t of Object.keys(to.fl)) if (JSON.stringify(from.fl[t]) !== JSON.stringify(to.fl[t])) return t;
  return "t1";
}
const tabName = (v: Vars, t: string) =>
  !twoTabs(v) ? "the page" : t === "t1" ? "your tab" : v.page.t2 === "B" ? "the other reader's tab" : "your second tab";

/** The note an action of the reader's was about. */
function noteOf(from: Vars, to: Vars): string {
  for (const x of ["n", "s"]) if (JSON.stringify(from.want[x]) !== JSON.stringify(to.want[x])) return x;
  return to.ui.act !== "none" ? to.ui.note : from.ui.note;
}
const what = (i: Item) =>
  `${i.op === "create" ? "the new note" : i.op === "edit" ? "an edit" : i.op === "remove" ? "a removal" : "a return"}${i.owner === "none" ? " saved before owners were recorded" : ""}`;

export function step(action: string, from: Vars, to: Vars): string | null {
  const t = tabOf(from, to);
  const tab = tabName(from, t);
  const grew = items(to).length > items(from).length;
  switch (action) {
    case "NetworkDrops":
      return "the network drops";
    case "NetworkReturns":
      return "the network comes back";
    case "YouSignOut":
      return "you sign out";
    case "YouSignIn":
      return "you sign in again";
    case "AnotherReaderSignsIn":
      return "another reader signs in on this browser";
    case "AnotherReaderSignsOut":
      return "the other reader signs out";
    case "ATabOpens":
      return to.page.t2 === "B" ? "the other reader opens a book in a second tab" : "you open the book in a second tab";
    case "ATabCloses":
      return "the second tab is closed";
    case "YouWriteANote":
      if (to.srv.n.state === "live" && grew) return "you write a note; the library stores it but its answer is lost";
      return "you write a note";
    case "YouEditANote":
      return `you start editing ${NAME[noteOf(from, to)]}`;
    case "YouRemoveANote":
      return `you start removing ${NAME[noteOf(from, to)]}`;
    case "YouPressUndo":
      return "you press Undo [within 10 seconds]";
    case "YouFinishChange": {
      const x = from.ui.note;
      const verb = from.ui.op === "edit" ? "the edit" : from.ui.op === "remove" ? "the removal" : "the return";
      if (from.ui.behind) return `${verb} goes behind the change of ${NAME[x]} that still waits`;
      if (JSON.stringify(to.srv[x]) !== JSON.stringify(from.srv[x]) && grew) return `the library takes ${verb} but its answer is lost; it waits here too`;
      return grew ? `no network: ${verb} waits here` : `${verb} is sent at once`;
    }
    case "RemovedElsewhere":
      return "you remove your saved note on another device";
    case "FlushRechecks":
      return `${tab} reads the next item again before sending it`;
    case "FlushReads":
      return `${tab} starts sending what waits`;
    case "FlushSends": {
      const sent = Object.values(from.fl[t].todo ?? {})[0];
      const thing = sent ? what(sent) : "it";
      const after = to.fl[t];
      if (after.pc !== "answer") return from.net === "down" ? `${tab} cannot send ${thing}: no network` : `${tab} sends ${thing}; the library fails`;
      if (after.st === 401) return `${tab} sends ${thing}; nobody is signed in`;
      if (after.st >= 400) return `${tab} sends ${thing}; the library refuses it${to.session === "B" ? " (another reader is signed in)" : ""}`;
      const x = sent?.note ?? "n";
      // Read before the reader's last change to this note (the list is read once, when sending starts).
      const stale = sent && Math.max(from.want[x].pseq, from.want[x].words) > sent.seq;
      const changed = JSON.stringify(to.srv[x]) !== JSON.stringify(from.srv[x]);
      if (!changed) return `${tab} sends ${thing} again; the library already has it`;
      return stale ? `the library takes ${thing}, a copy read before your last change` : `the library takes ${thing}`;
    }
    case "FlushGetsAnswer": {
      const st = from.fl[t].st;
      if (st >= 200 && st < 300) return `the library's answer reaches ${tab}; the copy here is deleted`;
      if (st === 401) return `${tab} stops: nobody is signed in`;
      return `${tab} keeps it as 'Could not be saved'`;
    }
    case "FlushLosesAnswer":
      return `the library's answer to ${tab} is lost`;
    default:
      return action;
  }
}

export function group(v: Vars): string {
  const n = noteLabel(v, "n");
  if (n === "Not written yet") return "Not written";
  if (n.startsWith("Removed")) return "Removed";
  if (n === "Saved on the library") return "Saved";
  return "In between";
}

export const colors = { "Not written": "blue", "In between": "yellow", Saved: "teal", Removed: "tan" };
