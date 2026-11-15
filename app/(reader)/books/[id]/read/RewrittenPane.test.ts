// Rewrite as you turn (M17 R3) on the real RewrittenPane: React 19 renders it into linkedom's document in Node
// (no browser), and every request to the server is answered by hand, so a test can choose the order in which the
// answers, the clicks and React's renders come. Each test is one path of RewriteAsYouTurn.tla
// (.claude/skills/verify-spending/), and each of findings 8, 9 and 10 of that check fails here on the code before
// the fix. Paragraphs cost 60 cents (40 where two must fit in $1); the price shown is the estimate, the same.
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
  (window as unknown as { scrollTo: () => void }).scrollTo = () => {};
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

const piece = (id: string, cost: number) => ({ id, cfi: id, text: `The text of ${id}.`, rewrite: null, estimate: cost, form: "prose" });
const view = (ids: string[], cost = 0.6) => ({ style: "plain", pieces: ids.map((id) => piece(id, cost)), fake: true });
const made = (id: string, cost = 0.6, reused = false) => ({
  style: "plain",
  reused,
  generation: { id: `g-${id}`, text: `Rewritten ${id}.`, provenance: { costUsd: cost, provider: "anthropic", model: "fake" } },
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
  const { RewrittenPane } = await import("./RewrittenPane");
  const { turnStore } = await import("@/lib/library/rewritten-turn");
  const controls: { page?: (p: string) => void; show?: (open: boolean) => void } = {};
  // As Reader.tsx: the turn state is the reader's, so it outlives the pane.
  function Host() {
    const [turns] = React.useState(turnStore);
    const [page, setPage] = React.useState("pageA");
    const [open, setOpen] = React.useState(true);
    controls.page = setPage;
    controls.show = setOpen;
    return open ? React.createElement(RewrittenPane, { bookId: "book", from: page, to: page, mode: "side", onMode: () => {}, turns }) : null;
  }
  const root = createRoot(document.getElementById("root") as unknown as Element);
  root.render(React.createElement(Host));
  await sleep(20);
  return { root, controls };
}

/** Presses a button by its text, as React's own click handler would be called (waiting up to 1 s for it to show). */
async function press(text: string) {
  for (let i = 0; i < 200; i++) {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith(text));
    const props = button && (Object.entries(button).find(([k]) => k.startsWith("__reactProps"))?.[1] as { onClick: () => void } | undefined);
    if (props) return props.onClick();
    await sleep(5);
  }
  throw new Error(`No button "${text}" (on screen: ${document.body.textContent})`);
}
/** Waits up to 1 s for the pane to show this text. */
async function shows(text: string) {
  for (let i = 0; i < 200 && !(document.body.textContent ?? "").includes(text); i++) await sleep(5);
  expect(document.body.textContent).toContain(text);
}

const paidPost = async (label: string, cost = 0.6) => {
  const post = await take(isPost, label);
  post.reply(201, made(post.body?.sectionId as string, cost));
  await sleep(20);
  return post.body?.sectionId;
};
/** The paragraphs sent to be paid for in the next 300 ms (none expected). */
const noPost = async () => {
  await sleep(300);
  return pending.filter(isPost).map((p) => p.body?.sectionId);
};

describe("rewrite as you turn: never past $1 since the go-ahead without asking (finding 8)", () => {
  it("asks before a paragraph whose price would take the total past $1, not after it is paid", async () => {
    pending.length = 0;
    const { root } = await mount();
    (await take(isGet("pageA"), "the page")).reply(200, view(["a1", "a2", "a3"]));
    await sleep(20);
    await press("Rewrite this page");
    expect(await paidPost("a1")).toBe("a1");
    // $0.60 paid; a2 would make $1.20: it asks first, with the page's price and the total.
    expect(await noPost()).toEqual([]);
    await shows("Keep rewriting? This page costs about $1.20. So far: 1 paragraph rewritten, about $0.60.");
    await press("Keep rewriting");
    expect(await paidPost("a2")).toBe("a2");
    expect(await noPost()).toEqual([]);
    await shows("Keep rewriting? This page costs about $0.60. So far: 2 paragraphs rewritten, about $1.20.");
    root.unmount();
  });

  it("writes a paragraph that alone costs more than $1 only right after the reader's press, at the price shown", async () => {
    pending.length = 0;
    const { root, controls } = await mount();
    (await take(isGet("pageA"), "the page")).reply(200, view(["a1"], 1.2));
    await sleep(20);
    await shows("It costs about $1.20, once;");
    await press("Rewrite this page");
    expect(await paidPost("a1", 1.2)).toBe("a1");
    // The next page also costs $1.20: it is not paid when turned to; it asks.
    controls.page?.("pageB");
    (await take(isGet("pageB"), "the next page")).reply(200, view(["b1"], 1.2));
    expect(await noPost()).toEqual([]);
    await shows("Keep rewriting? This page costs about $1.20.");
    await press("Keep rewriting");
    expect(await paidPost("b1", 1.2)).toBe("b1");
    root.unmount();
  });
});

describe("rewrite as you turn: the total is current when a page arrives (finding 9)", () => {
  it("the next page's view arrives before React renders the new total: it still counts the paragraph just paid", async () => {
    pending.length = 0;
    const { root, controls } = await mount();
    // The page arrives: two paragraphs of 60 cents. You ask for a rewrite; a1 is sent.
    (await take(isGet("pageA"), "the first page")).reply(200, view(["a1", "a2"]));
    await sleep(20);
    await press("Rewrite this page");
    const a1 = await take(isPost, "a1");
    // You turn the page (React renders, and asks for the new page after 250 ms).
    controls.page?.("pageB");
    const pageB = await take(isGet("pageB"), "the second page");
    // a1 is paid ($0.60) and its loop stops (the page was turned); at once, before React renders, page B arrives.
    a1.reply(201, made("a1"));
    await microtasks();
    pageB.reply(200, view(["b1", "b2"]));
    await microtasks();
    // b1 would make $1.20: nothing is sent; it asks. (Before the fix the new loop counted from $0 and sent b1 and b2.)
    expect(await noPost()).toEqual([]);
    await shows("Keep rewriting? This page costs about $1.20. So far: 1 paragraph rewritten, about $0.60.");
    root.unmount();
  });
});

describe("rewrite as you turn: closing the pane mid-loop (finding 10)", () => {
  it("switch to Original and back, press Stop: nothing more is sent, and the new pane does not send a1 again meanwhile", async () => {
    pending.length = 0;
    const { root, controls } = await mount();
    (await take(isGet("pageA"), "the page")).reply(200, view(["a1", "a2"], 0.4));
    await sleep(20);
    await press("Rewrite this page");
    const a1 = await take(isPost, "a1");
    // You switch to Original (the pane closes) and open Side by side (a new pane); its page arrives.
    controls.show?.(false);
    await sleep(20);
    controls.show?.(true);
    (await take(isGet("pageA"), "the page, in the new pane")).reply(200, view(["a1", "a2"], 0.4));
    // One loop at a time: the new pane waits for a1, which the closed pane's loop is still paying for.
    expect(await noPost()).toEqual([]);
    await press("Stop");
    await sleep(20);
    a1.reply(201, made("a1", 0.4));
    expect(await noPost()).toEqual([]);
    root.unmount();
  });

  it("switch to Original and back: once a1 is paid, the new pane writes a2, and the total counts both", async () => {
    pending.length = 0;
    const { root, controls } = await mount();
    (await take(isGet("pageA"), "the page")).reply(200, view(["a1", "a2"], 0.4));
    await sleep(20);
    await press("Rewrite this page");
    const a1 = await take(isPost, "a1");
    controls.show?.(false);
    await sleep(20);
    controls.show?.(true);
    (await take(isGet("pageA"), "the page, in the new pane")).reply(200, view(["a1", "a2"], 0.4));
    expect(await noPost()).toEqual([]);
    a1.reply(201, made("a1", 0.4));
    // The new pane goes on with its page: a1 again (saved by now: the server serves it free), then a2.
    const again = await take(isPost, "a1, from the new pane");
    expect(again.body?.sectionId).toBe("a1");
    again.reply(200, made("a1", 0.4, true));
    expect(await paidPost("a2", 0.4)).toBe("a2");
    expect(await noPost()).toEqual([]);
    await shows("So far: 2 paragraphs rewritten, about $0.80.");
    root.unmount();
  });

  it("switch to Original mid-loop and stay there: the closed pane's loop sends nothing more", async () => {
    pending.length = 0;
    const { root, controls } = await mount();
    (await take(isGet("pageA"), "the page")).reply(200, view(["a1", "a2"], 0.4));
    await sleep(20);
    await press("Rewrite this page");
    const a1 = await take(isPost, "a1");
    controls.show?.(false);
    await sleep(20);
    a1.reply(201, made("a1", 0.4));
    expect(await noPost()).toEqual([]);
    root.unmount();
  });
});

describe("rewrite as you turn: Stop", () => {
  it("Stop while a paragraph is with the AI: after its answer, nothing more is sent", async () => {
    pending.length = 0;
    const { root } = await mount();
    (await take(isGet("pageA"), "the page")).reply(200, view(["a1", "a2"], 0.4));
    await sleep(20);
    await press("Rewrite this page");
    const a1 = await take(isPost, "a1");
    await sleep(20);
    await press("Stop");
    await sleep(20);
    a1.reply(201, made("a1", 0.4));
    expect(await noPost()).toEqual([]);
    root.unmount();
  });

  it("turned-to pages are rewritten without a click while the total stays within $1", async () => {
    pending.length = 0;
    const { root, controls } = await mount();
    (await take(isGet("pageA"), "the page")).reply(200, view(["a1"], 0.4));
    await sleep(20);
    await press("Rewrite this page");
    expect(await paidPost("a1", 0.4)).toBe("a1");
    controls.page?.("pageB");
    (await take(isGet("pageB"), "the next page")).reply(200, view(["b1", "b2"], 0.4));
    expect(await paidPost("b1", 0.4)).toBe("b1");
    // $0.80 paid; b2 would make $1.20.
    expect(await noPost()).toEqual([]);
    await shows("Keep rewriting? This page costs about $0.40. So far: 2 paragraphs rewritten, about $0.80.");
    root.unmount();
  });
});
