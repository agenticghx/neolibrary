// The words for the chart of SpendCap.tla (the statechart skill reads this "view").
// Written for: whoever reads the chart. One region per paid request; money in the reader's words.
const words = {
  new: "Asked",
  looked: "Asked",
  waitLock: "Asked",
  deciding: "Checking the limit",
  calling: "Reserved: the AI is working",
  saving: "The AI is paid: cost not written yet",
  recordingFailure: "The AI is paid: cost not written yet",
  releasing: "Cost written: reservation still held",
  releasingEarly: "The AI is paid: cost not written yet",
  savingLate: "The AI is paid: cost not written yet",
  orphan: "Lost in a restart",
  done: "Done: reservation released",
  reused: "Served free: a saved or shared answer",
  refused: "The limit is reached",
  lost: "Lost in a restart",
};

const label = (v, c) => {
  const pc = v.pc[c];
  const unwritten = v.billed[c] > v.recorded[c];
  if (pc === "releasing") {
    if (v.billed[c] === 0) return "Failed unpaid: reservation still held";
    if (unwritten) return "Paid, cost not written: reservation still held";
  }
  if (pc === "done" && unwritten) return "Done: paid, but the cost was never written";
  return words[pc];
};

export const title = "Two paid requests at once, one spending limit";

export const state = (v) => {
  const calls = Object.keys(v.pc);
  return Object.fromEntries(calls.map((c) => [`Request ${c}`, label(v, c)]));
};

export const step = (action, from, to) => {
  const name = action.replace(/\(.*$/, "");
  switch (name) {
    case "LookForSavedAnswer": {
      const c = Object.keys(to.pc).find((k) => from.pc[k] === "new" && to.pc[k] !== "new");
      return to.pc[c] === "reused" ? "a saved answer is found" : "no saved answer is found";
    }
    case "CheckSameRequestInFlight": {
      const c = Object.keys(to.pc).find((k) => from.pc[k] === "looked" && to.pc[k] !== "looked");
      return to.pc[c] === "reused" ? "it shares the identical request running" : "no identical request is running";
    }
    case "TakeLockAndReadSpending":
      return "it reads what has been spent";
    case "DecideAndHold": {
      const c = Object.keys(to.pc).find((k) => from.pc[k] === "deciding" && to.pc[k] !== "deciding");
      return to.pc[c] === "refused" ? "the estimate does not fit" : "the estimate fits: it is reserved";
    }
    case "TheAiAnswers":
      return "the AI answers, and is paid";
    case "TheAiFailsButBills":
      return "the AI fails, and is paid anyway";
    case "TheAiFailsUnbilled":
      return "the AI fails, unpaid";
    case "SaveTheAnswer":
      return "the answer and its cost are saved";
    case "RecordTheBilledFailure":
      return "the failed call's cost is written";
    case "ReleaseTheHold":
      return "the reservation is released";
    case "AllFinished":
      return null;
    case "ServerRestarts":
      return "the server restarts";
    case "TheAiFinishesAnOrphanedCall":
      return "the AI finishes the call nobody waits for, and may be paid";
    case "SaveFails":
      return "saving the paid answer fails";
    case "TextEditionReads":
      return "a text edition is started: it reads what has been spent";
    case "TextEditionDecides":
      return "the text edition's estimate fits: its job is saved";
    case "TextEditionBilled":
      return "the text edition's pages are read, and paid";
    case "TextEditionStored":
      return "the pages and their cost are saved";
    case "TextEditionEnds":
      return "the text edition ends";
    default:
      return name;
  }
};
