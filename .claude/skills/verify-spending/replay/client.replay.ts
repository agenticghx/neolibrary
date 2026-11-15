// The real RewrittenPane: React 19 renders it into linkedom's document in Node (no browser), and every
// request to the server is answered by hand. Two kinds of test:
// - "steps": the pane takes the steps RewriteAsYouTurn.tla assumes; they pass on the code as it is
//   (like conformance.replay.ts). One that fails means the code changed under the model.
// - "findings" 9 and 10: each PASSES WHILE THE BUG IS THERE (see findings.replay.ts).
import { parseHTML } from "linkedom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Body = Record<string, unknown>;
type Pending = { url: string; method: string; body: Body | null; reply: (status: number, body: Body) => void };

const { window, document } = parseHTML("<!doctype html><html><body><main id=root></main></body></html>");
const pending: Pending[] = [];
const g = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};

beforeAll(() => {
  for (const k of ["window", "document", "HTMLElement", "Node", "fetch"]) saved[k] = g[k];
  Object.assign(g, { window, document, HTMLElement: window.HTMLElement, Node: window.Node });
  g.fetch = (url: string, init: RequestInit = {}) =>
    new Promise((resolve) =>
      pending.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? (JSON.parse(String(init.body)) as Body) : null,
        reply: (status, body) => resolve({ ok: status < 400, status, json: async () => body }),
      }),
    );
  window.scrollTo = () => {};
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50)); // React finishes unmounting before the globals go
  Object.assign(g, saved);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Lets promise callbacks run, but not React's next render (that waits for a later task). */
const microtasks = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

const COST = 0.6;
const piece = (id: string) => ({ id, cfi: id, text: `The text of ${id}.`, rewrite: null, estimate: COST, form: "prose" });
const view = (ids: string[]) => ({ style: "plain", pieces: ids.map(piece), fake: true });
const made = (id: string) => ({
  style: "plain",
  reused: false,
  generation: { id: `g-${id}`, text: `Rewritten ${id}.`, provenance: { costUsd: COST, provider: "anthropic", model: "fake" } },
});

const take = async (what: (p: Pending) => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    const at = pending.findIndex(what);
    if (at >= 0) return pending.splice(at, 1)[0];
    await sleep(5);
  }
  throw new Error(`No request: ${label}`);
};
const isGet = (page: string) => (p: Pending) => p.method === "GET" && p.url.includes(`from=${page}`);
const isPost = (p: Pending) => p.method === "POST";

async function mount() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { RewrittenPane } = await import("@/app/(reader)/books/[id]/read/RewrittenPane");
  const { TURN_OFF } = await import("@/lib/library/rewritten-turn");
  const controls: { page?: (p: string) => void; show?: (open: boolean) => void } = {};
  function Host() {
    const [turn, setTurn] = React.useState(TURN_OFF);
    const [page, setPage] = React.useState("pageA");
    const [open, setOpen] = React.useState(true);
    controls.page = setPage;
    controls.show = setOpen;
    return open
      ? React.createElement(RewrittenPane, { bookId: "book", from: page, to: page, mode: "side", onMode: () => {}, turn, setTurn })
      : null;
  }
  const root = createRoot(document.getElementById("root") as unknown as Element);
  root.render(React.createElement(Host));
  await sleep(20);
  return { root, controls };
}

/** Presses a button by its text, as React's own click handler would be called. */
function press(text: string) {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith(text));
  if (!button) throw new Error(`No button "${text}" (on screen: ${document.body.textContent})`);
  const props = Object.entries(button).find(([k]) => k.startsWith("__reactProps"))?.[1] as { onClick: () => void };
  props.onClick();
}

const paidPost = async (label: string) => {
  const post = await take(isPost, label);
  post.reply(201, made(post.body?.sectionId as string));
  await sleep(20);
  return post.body?.sectionId;
};
const noPost = async () => {
  await sleep(300);
  return pending.filter(isPost).map((p) => p.body?.sectionId);
};

describe("RewriteAsYouTurn.tla's steps, in the real RewrittenPane", () => {
  it("TheLoopDecides stops at AskAt: two 60-cent paragraphs are paid ($1.20), then it asks before the third", async () => {
    pending.length = 0;
    const { root } = await mount();
    (await take(isGet("pageA"), "the page")).reply(200, view(["a1", "a2", "a3"]));
    await sleep(20);
    press("Rewrite this page");
    expect([await paidPost("a1"), await paidPost("a2")]).toEqual(["a1", "a2"]);
    expect(await noPost()).toEqual([]);
    expect(document.body.textContent).toContain("Keep rewriting?");
    root.unmount();
  });

  it("YouPressStop: Stop while a paragraph is with the AI; after its answer, nothing more is sent", async () => {
    pending.length = 0;
    const { root } = await mount();
    (await take(isGet("pageA"), "the page")).reply(200, view(["a1", "a2"]));
    await sleep(20);
    press("Rewrite this page");
    const a1 = await take(isPost, "a1");
    await sleep(20);
    press("Stop");
    await sleep(20);
    a1.reply(201, made("a1"));
    expect(await noPost()).toEqual([]);
    root.unmount();
  });
});

describe("RewriteAsYouTurn findings, on the real RewrittenPane", () => {
  it("Finding 9 (RewriteAsYouTurn-finding-stale-turn): the next page's view arrives before React copies the new total, and a paragraph is paid past $1 without asking", async () => {
    pending.length = 0;
    const { root, controls } = await mount();
    let paid = 0; // what the AI has been paid since the go-ahead
    const paidWhenSent: number[] = [];
    // 1. the page arrives: two paragraphs of 60 cents.
    (await take(isGet("pageA"), "the first page")).reply(200, view(["a1", "a2"]));
    await sleep(20);
    // 2. you ask for a rewrite. 3. the next paragraph is sent to the AI.
    press("Rewrite this page");
    const a1 = await take(isPost, "a1");
    paidWhenSent.push(paid);
    // 4. you turn the page (React renders, and asks for the new page after 250 ms).
    controls.page?.("pageB");
    const pageB = await take(isGet("pageB"), "the second page");
    // 5. the AI is paid; the loop stops: you turned the page. 6-7. at once, the page arrives, before React renders.
    a1.reply(201, made(a1.body?.sectionId as string));
    paid += COST;
    await microtasks();
    pageB.reply(200, view(["b1", "b2"]));
    await microtasks();
    // 8-10. a new loop starts from the old total ($0, not $0.60): b1 is paid ($1.20), then b2 is sent.
    for (let i = 0; i < 2; i++) {
      const post = await take(isPost, `paragraph ${i + 1} of page B`);
      paidWhenSent.push(paid);
      post.reply(201, made(post.body?.sectionId as string));
      paid += COST;
      await sleep(20);
    }
    root.unmount();
    expect(paidWhenSent).toEqual([0, 0.6, 1.2]);
    expect(Math.max(...paidWhenSent)).toBeGreaterThanOrEqual(1);
  });

  it("Finding 10 (RewriteAsYouTurn-finding-pane-closed-stop): switch to Original and back, press Stop, and the first loop still pays", async () => {
    pending.length = 0;
    const { root, controls } = await mount();
    // 1. the page arrives. 2-3. you ask for a rewrite; a1 is sent to the AI.
    (await take(isGet("pageA"), "the page")).reply(200, view(["a1", "a2"]));
    await sleep(20);
    press("Rewrite this page");
    const a1 = await take(isPost, "a1");
    // 4. you switch to Original (the pane unmounts). 5. you open Side by side (a new pane). 6. its page arrives
    // (its own loop asks for a1 too, which the server shares with the call in flight). 7. you press Stop.
    controls.show?.(false);
    await sleep(20);
    controls.show?.(true);
    (await take(isGet("pageA"), "the page, in the new pane")).reply(200, view(["a1", "a2"]));
    await sleep(20);
    const shared = await take(isPost, "a1, from the new pane");
    expect(shared.body?.sectionId).toBe("a1");
    press("Stop");
    await sleep(20);
    // 8. the AI is paid for a1. 9. the first loop, with its old refs, sends a2.
    a1.reply(201, made("a1"));
    shared.reply(200, { ...made("a1"), reused: true });
    const after = await take(isPost, "a paragraph sent after Stop");
    expect(after.body?.sectionId).toBe("a2");
    after.reply(201, made("a2"));
    await sleep(20);
    root.unmount();
  });
});
