/**
 * Genealogy views (M43 S3), drawn into one element: Family tree; Inside a company (Power map, Money and parts, Who
 * was there when); One person (Storyline, Read vs happened, List). Written for Claude sessions; Samuel chose and
 * reviewed these views on the laptop page, whose script this was, moved into the app: its state kept per mount, its
 * look in GenealogyView.module.css, and every quote able to turn the reader's page to where the book says it.
 *
 * The laptop page (scripts/genealogy-on-subscription.ts `page`, for runs not yet sent to the site) is drawn by this
 * same file, its types stripped and inlined, so a change here shows in both. Keep it free of imports other than types.
 */
import type { GenealogyView, GenealogyViewEvent, GenealogyViewLink } from "@/lib/library/genealogy-view";

type L = GenealogyViewLink;
type Kid = Node | string | number | null | undefined | false | Kid[];
type Attrs = Record<string, unknown>;
export type GenealogyTop = "tree" | "org" | "person";
/** `styles` maps the class names used here to a CSS module's (GenealogyView.module.css). */
/** M43: the same name in another book's genealogy, and the address that opens that book's views on it. */
export type GenealogyAlso = { title: string; name: string; links: number; href: string };
export type GenealogyOptions = {
  view?: GenealogyTop;
  focus?: string;
  styles?: Record<string, string>;
  onGo: (cfi: string) => void;
  onClose: () => void;
  /** "Also in <book>": the reader's other books with this name, for the view it is shown in. */
  also?: (name: string, kind: "person" | "organisation", view: GenealogyTop) => Promise<GenealogyAlso[]>;
};

const SVGNS = "http://www.w3.org/2000/svg";
const REL: Record<string, string> = { founded: "founded", worked_at: "worked at", led: "led", left: "left", advised: "advised", spun_out_of: "spun out of", acquired: "bought", bought_part_of: "bought part of", part_of: "is part of", funded: "funded", supplied: "supplied", partnered: "partnered with", mentored: "mentored", hired: "hired", worked_for: "worked for", friend: "is a friend of", family: "is family of" };
const CAT: Record<string, { label: string; color: string; side: "people" | "up" | "down" | "in" | "out" }> = {
  founder: { label: "Founded it", color: "var(--person)", side: "people" },
  leader: { label: "Led it", color: "var(--person)", side: "people" },
  staff: { label: "Worked there", color: "var(--person)", side: "people" },
  adviser: { label: "Advised it", color: "var(--person)", side: "people" },
  parent: { label: "Came from / owned by", color: "var(--family)", side: "up" },
  offspring: { label: "Its offspring and purchases", color: "var(--family)", side: "down" },
  money_in: { label: "Money in", color: "var(--money)", side: "in" },
  supplier: { label: "Suppliers", color: "var(--parts)", side: "in" },
  bought_from: { label: "Bought part of", color: "var(--family)", side: "in" },
  customer: { label: "Customers", color: "var(--parts)", side: "out" },
  money_out: { label: "Money out", color: "var(--money)", side: "out" },
  sold_to: { label: "Sold part of itself to", color: "var(--family)", side: "out" },
  partner: { label: "Partners", color: "var(--partner)", side: "out" },
};
const ORDER = Object.keys(CAT);
const BASIS: Record<string, [string, string]> = { stated: ["year from the book", "b-stated"], worked_out: ["year worked out from the book", "b-worked"], ordered: ["placed by the book's order", "b-ordered"], unknown: ["order not given", "b-unknown"] };
const ACTIVE: Record<string, string> = { worked_for: "worked for", friend: "friend of", founded: "founded", worked_at: "worked at", led: "led", left: "left", advised: "advised", hired: "hired", mentored: "mentored", partnered: "partnered with", funded: "funded", family: "family of", supplied: "supplied", acquired: "bought", bought_part_of: "bought part of", part_of: "part of", spun_out_of: "spun out of" };
const PASSIVE: Record<string, string> = { worked_for: "employed", friend: "friend of", family: "family of", founded: "founded by", hired: "hired by", mentored: "mentored by", advised: "advised by", funded: "funded by", supplied: "supplied by", led: "led by", worked_at: "employed", acquired: "bought by" };

let CLS: Record<string, string> = {};
/** A class list, each name as the CSS module calls it. */
const cls = (names: string) =>
  names
    .split(" ")
    .filter(Boolean)
    .map((n) => CLS[n] ?? n)
    .join(" ");
function build<T extends Element>(e: T, attrs: Attrs, kids: Kid[]): T {
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") e.setAttribute("class", cls(String(v)));
    else if (v != null && v !== false) e.setAttribute(k, String(v));
  }
  const add = (k: Kid) => {
    if (Array.isArray(k)) k.forEach(add);
    else if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return e;
}
const el = (tag: string, attrs: Attrs = {}, ...kids: Kid[]) => build(document.createElement(tag), attrs, kids);
const S = (tag: string, attrs: Attrs = {}, ...kids: Kid[]) => build(document.createElementNS(SVGNS, tag), attrs, kids);
const wrapWords = (s: string, n: number) => {
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(" ")) {
    if (cur && (cur + " " + w).length > n) {
      out.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
  }
  if (cur) out.push(cur);
  return out;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const span = (a: number, b: number | null | undefined) => `${a}${b && b !== a ? "–" + String(b).slice(-2) : ""}`;

type Around = { name: string; kind: string; cats: Set<string>; links: L[]; cat: string; first: number; last: number; role: string | null; x: number; y: number; a: number };
type Lineage = { parent: string; child: string; hows: Set<string>; people: Set<string>; items: { link: L; inferred?: boolean }[]; book: boolean };
type Step = Omit<GenealogyViewEvent, "gk"> & { gk?: GenealogyViewEvent["gk"]; i: number; ls: L[]; other: string; kind: string; verb: string; rel: string; first: number };

/** Draws the views into `root`; returns a function that takes them down again. */
export function mountGenealogy(root: HTMLElement, D: GenealogyView, opts: GenealogyOptions): () => void {
  CLS = opts.styles ?? {};
  let view: GenealogyTop = opts.view ?? "tree";
  let upto = Math.min(Math.max(D.at, 1), D.n);
  const focus: Record<GenealogyTop, string> = { tree: D.top.tree[0] || D.top.org[0] || "", org: D.top.org[0] || "", person: D.top.person[0] || "" };
  if (opts.focus) focus[view] = opts.focus;
  let orgMode: "orbit" | "flow" | "time" = "orbit";
  let personMode: "story" | "read" | "list" = "story";
  let minLinks = 3;
  let showGK = true;
  let redraw: (() => void) | null = null;
  // "Also in <book>": asked once per name and view, filled in under the name when it comes.
  const alsoCache = new Map<string, Promise<GenealogyAlso[]>>();
  const alsoLine = (name: string, v: GenealogyTop) => {
    const box = el("div", { class: "also", "data-testid": "genealogy-also" });
    if (!opts.also || !name) return box;
    const key = `${v}\u0000${name}`;
    if (!alsoCache.has(key)) alsoCache.set(key, opts.also(name, kindOf(name) === "person" ? "person" : "organisation", v).catch(() => []));
    void alsoCache.get(key)!.then((list) => {
      if (!list.length) return;
      box.append(
        el("span", { class: "alsoLabel" }, "Also in"),
        ...list.map((a) => el("a", { class: "chip", href: a.href }, a.title, el("small", {}, `${a.name !== name ? `as ${a.name} · ` : ""}${plural(a.links, "link")}`))),
      );
    });
    return box;
  };
  const PARTS = D.parts;
  const kindOf = (n: string) => D.nodes[n] || "organisation";
  const live = () => D.links.filter((l) => l.chapter <= upto);
  const sentence = (l: L) => `${l.from} ${REL[l.relation] || l.relation} ${l.to}`;
  const width = () => root.clientWidth || 900;
  const narrowNow = () => width() < 700;
  const where = (chapter: number) => `Chapter ${chapter}: ${D.chapters[chapter] ?? ""}`;
  const goTo = (cfi: string | null) => (cfi ? el("button", { class: "go-book", onclick: () => opts.onGo(cfi) }, "Go to this place in the book") : null);

  // ---------- the frame ----------
  const views: [GenealogyTop, string][] = [
    ["tree", "Family tree"],
    ["org", "Inside a company"],
    ["person", "One person"],
  ];
  const tabs = el("div", { class: "tabs", role: "group", "aria-label": "View" }, views.map(([v, t]) => el("button", { type: "button", "data-v": v, "aria-pressed": String(v === view), onclick: () => show(v) }, t)));
  const slider = el("input", { id: "gn-upto", type: "range", min: 1, max: D.n, value: upto, "aria-label": "Read up to chapter" }) as HTMLInputElement;
  const out = el("output", { for: "gn-upto" });
  const back = el("button", { type: "button", class: "chip", hidden: true, onclick: () => setUpto(D.at) }, "Back to where I am");
  const setUpto = (n: number) => {
    upto = n;
    slider.value = String(n);
    render();
  };
  slider.addEventListener("input", () => setUpto(+slider.value));
  const stage = el("section", { class: "view" });
  const drawer = el("div", { class: "drawer", hidden: true, role: "dialog", "aria-label": "Where the book says it" });
  const dbody = el("div");
  drawer.append(el("button", { type: "button", class: "dx", "aria-label": "Close", onclick: () => (drawer.hidden = true) }, "×"), dbody);
  const sent = new Date(D.sentAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const doubted = [...D.doubted].sort((a, b) => a.chapter - b.chapter);
  root.replaceChildren();
  build(root, {}, [
    el(
      "header",
      { class: "intro" },
      el("h2", { class: "title" }, `${D.book}: genealogy`),
      el("p", { class: "made" }, `Read by Claude (${D.model}), ${sent}.`),
    ),
    el("div", { class: "bar" }, tabs, el("div", { class: "upto" }, el("label", { for: "gn-upto" }, "Read up to chapter"), slider, out, back)),
    stage,
    doubted.length
      ? el(
          "details",
          { class: "doubted" },
          el("summary", {}, `Links the second reading removed (${doubted.length})`),
          el("div", { class: "removed" }, doubted.map((l) => el("div", {}, el("b", {}, sentence(l)), ` · ch ${l.chapter} · `, el("em", {}, l.why || ""), el("div", { class: "hint" }, `"${l.quote}"`), goTo(l.cfi)))),
        )
      : null,
    drawer,
  ]);

  // ---------- evidence drawer ----------
  function openEvidence(title: string, items: (L | { link: L; inferred?: boolean })[], go?: Node[]) {
    dbody.replaceChildren(el("h3", {}, title));
    for (const it of items) {
      const l = "link" in it ? it.link : it;
      const inferred = "link" in it && it.inferred;
      const badges: Node[] = [];
      if (l.was) badges.push(el("span", { class: "badge fix", title: l.why || "" }, "corrected"));
      if (inferred) badges.push(el("span", { class: "badge inf" }, "one of two quotes"));
      dbody.append(
        el(
          "div",
          { class: "ev-item" },
          el("div", { class: "s" }, sentence(l), l.role ? ` (${l.role})` : "", l.year ? `, ${l.year}` : "", badges),
          el("blockquote", {}, l.quote),
          el("div", { class: "meta" }, where(l.chapter)),
          l.was ? el("div", { class: "meta" }, `First reading said: "${l.was}". Second reading: ${l.why || ""}`) : null,
          goTo(l.cfi),
        ),
      );
    }
    if (go) dbody.append(el("div", { class: "go" }, go));
    drawer.hidden = false;
    drawer.scrollTop = 0;
  }
  // Escape closes the drawer, then the views; before the reader's own keys see it (it would close the Study panel).
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (!drawer.hidden) drawer.hidden = true;
    else opts.onClose();
  };
  window.addEventListener("keydown", onKey, true);
  const goButtons = (name: string) => {
    const b: Node[] = [];
    if (kindOf(name) === "organisation") {
      b.push(el("button", { class: "chip", onclick: () => show("tree", name) }, `${name}: family tree`));
      b.push(el("button", { class: "chip", onclick: () => show("org", name) }, `${name}: who was there`));
    } else b.push(el("button", { class: "chip", onclick: () => show("person", name) }, `${name}: path`));
    return b;
  };
  function show(v: GenealogyTop, name?: string) {
    view = v;
    if (name) focus[v] = name;
    drawer.hidden = true;
    render();
    root.querySelector(`.${cls("bar")}`)?.scrollIntoView({ block: "start" });
  }

  // ---------- lineage: which organisation came from which ----------
  /** The earliest year a person's rebuilt life gives for one of `whats` with `withName` (the book's, else general knowledge's when shown). */
  function lifeYear(person: string, whats: string[], withName: string) {
    const ys = (D.lives[person] ?? [])
      .filter((e) => e.with === withName && whats.includes(e.what))
      .map((e) => e.start_year || (showGK && e.gk?.start_year) || null)
      .filter((y): y is number => !!y);
    return ys.length ? Math.min(...ys) : null;
  }
  /** The latest year a person's rebuilt life places them at an organisation, up to `cap` (the founding they left it for). */
  function lastYearAt(person: string, withName: string, cap: number | null) {
    const ys = (D.lives[person] ?? [])
      .filter((e) => e.with === withName)
      .flatMap((e) => [e.start_year || (showGK && e.gk?.start_year) || null, e.end_year || (showGK && e.gk?.end_year) || null])
      .filter((y): y is number => !!y && (!cap || y <= cap));
    return ys.length ? Math.max(...ys) : null;
  }
  function lineage(Ls: L[]) {
    const E = new Map<string, Lineage>();
    const isOrg = (n: string) => kindOf(n) === "organisation";
    const add = (p: string, c: string, how: string, item: { link: L; inferred?: boolean }, person?: string) => {
      if (p === c) return;
      const k = p + "\u0000" + c;
      if (!E.has(k)) E.set(k, { parent: p, child: c, hows: new Set(), people: new Set(), items: [], book: false });
      const e = E.get(k)!;
      e.hows.add(how);
      if (person) e.people.add(person);
      e.items.push(item);
      if (!item.inferred) e.book = true;
    };
    for (const l of Ls) {
      if (!isOrg(l.from) || !isOrg(l.to)) continue;
      if (l.relation === "spun_out_of") add(l.to, l.from, "spun out", { link: l });
      if (l.relation === "acquired") add(l.from, l.to, "bought", { link: l });
      if (l.relation === "part_of") add(l.to, l.from, "part of it", { link: l });
    }
    // Founders who had been somewhere first: X descends from Y when a founder of X left Y to found it, that is, Y is
    // the last place they were at before X's founding. Earlier employers stay in their life, not in X's family
    // (Samuel, 2026-11-09: Philco is not a parent of Intel because Noyce once worked there).
    const first = (pred: (l: L) => boolean) => Ls.filter(pred).reduce((m, l) => Math.min(m, l.chapter), Infinity);
    for (const f of Ls.filter((l) => l.relation === "founded" && kindOf(l.from) === "person" && isOrg(l.to))) {
      const fx = first((l) => l.relation === "founded" && l.from === f.from && l.to === f.to);
      if (f.chapter !== fx) continue;
      const fdY = lifeYear(f.from, ["founded"], f.to);
      const before: { w: L; atY: number | null; wy: number }[] = [];
      // A company they had founded before counts as a place they were at (Noyce left Fairchild, which he co-founded, for Intel).
      const AT = ["worked_at", "led", "left", "founded"];
      for (const w of Ls.filter((l) => l.from === f.from && AT.includes(l.relation) && isOrg(l.to) && l.to !== f.to)) {
        const wy = first((l) => l.from === f.from && l.to === w.to && AT.includes(l.relation));
        if (w.chapter !== wy) continue;
        // Years from their rebuilt life win; the book's chapter order stands in only when a year is missing.
        const atY = lifeYear(f.from, ["worked_at", "worked_for", "led", "left", "founded"], w.to);
        if (atY && fdY ? atY > fdY : wy > fx) continue;
        if (w.year && f.year && w.year > f.year) continue;
        before.push({ w, atY: lastYearAt(f.from, w.to, fdY), wy });
      }
      if (!before.length) continue;
      // The one they were at last: by the latest year there when every one has a year, else (and on a tie) by where
      // the book first says it.
      const byYear = before.every((b) => b.atY !== null);
      const last = before.reduce((a, b) => ((byYear ? b.atY! - a.atY! : 0) || b.wy - a.wy) > 0 ? b : a);
      add(last.w.to, f.to, "founders came from here", { link: last.w, inferred: true }, f.from);
      add(last.w.to, f.to, "founders came from here", { link: f, inferred: true }, f.from);
    }
    // Drop an inferred edge whose reverse the book states outright.
    for (const [k, e] of E) {
      const r = E.get(e.child + "\u0000" + e.parent);
      if (r && r.book && !e.book) E.delete(k);
    }
    return [...E.values()];
  }

  function renderTree(box: HTMLElement) {
    const Ls = live();
    const E = lineage(Ls);
    const name = focus.tree;
    const orgs = [...new Set(E.flatMap((e) => [e.parent, e.child]))].sort();
    box.append(picker(orgs, "tree", D.top.tree));
    box.append(alsoLine(name, "tree"));
    box.append(el("div", { class: "legend" }, el("span", {}, el("i"), "the book says it came out of, was bought by, or is part of"), el("span", {}, el("i", { class: "d" }), "a founder left it to found the company (two quotes put together)")));
    if (!orgs.includes(name)) {
      box.append(el("p", { class: "empty" }, upto < D.n ? `Up to chapter ${upto}, the book has not yet linked ${name || "a company"} to another organisation.` : `The book links ${name || "no company"} to no other organisation as parent or offspring.`));
      return;
    }
    const CAP = 12;
    const gens: Record<string, string[]> = { "-2": [], "-1": [], "0": [name], "1": [], "2": [] };
    const via = new Map<string, Lineage>();
    const seen = new Set([name]);
    for (const g of [1, 2]) {
      for (const n of gens[String(-(g - 1))] || gens["0"])
        for (const e of E.filter((x) => x.child === n && !seen.has(x.parent))) {
          seen.add(e.parent);
          gens[String(-g)].push(e.parent);
          via.set(e.parent, e);
        }
      for (const n of gens[String(g - 1)])
        for (const e of E.filter((x) => x.parent === n && !seen.has(x.child))) {
          seen.add(e.child);
          gens[String(g)].push(e.child);
          via.set(e.child, e);
        }
    }
    const svg = S("svg");
    const tree = el("div", { class: "tree" }, svg);
    const label: Record<string, string> = { "-2": "Further back", "-1": "Came from", "0": "", "1": "Came out of it", "2": "And out of those" };
    const cards = new Map<string, HTMLElement>();
    for (const g of ["-2", "-1", "0", "1", "2"]) {
      const list = gens[g];
      if (!list.length) continue;
      const row = el("div", { class: "gen" });
      if (label[g]) row.append(el("div", { class: "genlabel" }, label[g]));
      for (const n of list.slice(0, CAP)) {
        const e = via.get(n);
        const how = e ? [...e.hows].join(", ") + (e.people.size ? ` · ${[...e.people].slice(0, 3).join(", ")}${e.people.size > 3 ? "…" : ""}` : "") : "";
        const c = el(
          "div",
          {
            class: "card" + (g === "0" ? " focus" : ""),
            tabindex: 0,
            role: "button",
            onclick: () =>
              g === "0" || !e
                ? openEvidence(`${n}: its links in the tree`, E.filter((x) => x.parent === n || x.child === n).flatMap((x) => x.items), goButtons(n))
                : openEvidence(`${e.child}, from ${e.parent}`, e.items, goButtons(n)),
            onkeydown: (ev: KeyboardEvent) => ev.key === "Enter" && (ev.currentTarget as HTMLElement).click(),
          },
          el("div", { class: "nm" }, n),
          how ? el("div", { class: "how" }, how) : null,
        );
        cards.set(n, c);
        row.append(c);
      }
      if (list.length > CAP) row.append(el("div", { class: "more" }, `+ ${list.length - CAP} more`));
      tree.append(row);
    }
    box.append(tree);
    const draw = () => {
      const r = tree.getBoundingClientRect();
      svg.replaceChildren();
      for (const [n, c] of cards) {
        const e = via.get(n);
        if (!e) continue;
        const other = cards.get(e.parent === n ? e.child : e.parent);
        if (!other) continue;
        const a = c.getBoundingClientRect();
        const b = other.getBoundingClientRect();
        const [top, bot] = a.top < b.top ? [a, b] : [b, a];
        const x1 = top.left + top.width / 2 - r.left;
        const y1 = top.bottom - r.top;
        const x2 = bot.left + bot.width / 2 - r.left;
        const y2 = bot.top - r.top;
        const m = (y1 + y2) / 2;
        svg.append(S("path", { d: `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`, fill: "none", stroke: e.book ? "var(--org)" : "var(--derived)", "stroke-width": e.book ? 2 : 1.6, "stroke-dasharray": e.book ? null : "5 4" }));
      }
    };
    requestAnimationFrame(draw);
    redraw = draw;
  }

  // ---------- inside a company ----------
  function around(X: string, Ls: L[]) {
    const M = new Map<string, Around>();
    for (const l of Ls) {
      if (l.from !== X && l.to !== X) continue;
      const o = l.from === X ? l.to : l.from;
      const isOut = l.from === X;
      const r = l.relation;
      let cat: string;
      if (kindOf(o) === "person") cat = r === "founded" ? "founder" : r === "led" ? "leader" : r === "advised" ? "adviser" : r === "funded" ? (isOut ? "money_out" : "money_in") : r === "supplied" ? (isOut ? "customer" : "supplier") : "staff";
      else
        cat =
          r === "funded"
            ? isOut
              ? "money_out"
              : "money_in"
            : r === "supplied"
              ? isOut
                ? "customer"
                : "supplier"
              : r === "spun_out_of" || r === "part_of"
                ? isOut
                  ? "parent"
                  : "offspring"
                : r === "acquired" || r === "founded"
                  ? isOut
                    ? "offspring"
                    : "parent"
                  : r === "bought_part_of"
                    ? isOut
                      ? "bought_from"
                      : "sold_to"
                    : r === "hired"
                      ? isOut
                        ? "supplier"
                        : "customer"
                      : "partner";
      if (!M.has(o)) M.set(o, { name: o, kind: kindOf(o), cats: new Set(), links: [], cat: "", first: 0, last: 0, role: null, x: 0, y: 0, a: 0 });
      const e = M.get(o)!;
      e.cats.add(cat);
      e.links.push(l);
    }
    for (const e of M.values()) {
      e.cat = ORDER.find((c) => e.cats.has(c)) ?? "partner";
      e.first = Math.min(...e.links.map((l) => l.chapter));
      e.last = Math.max(...e.links.map((l) => l.chapter));
      e.role = e.links.find((l) => l.role && l.relation === "led")?.role || e.links.find((l) => l.role)?.role || null;
    }
    return [...M.values()].sort((a, b) => ORDER.indexOf(a.cat) - ORDER.indexOf(b.cat) || a.first - b.first);
  }
  const evidenceFor = (X: string, e: Around) =>
    openEvidence(
      `${e.name} and ${X}`,
      [...e.links].sort((a, b) => a.chapter - b.chapter),
      goButtons(e.name),
    );
  const modeTabs = <T extends string>(modes: [T, string][], cur: T, set: (m: T) => void) =>
    el("div", { class: "tabs small", role: "group", "aria-label": "Drawing" }, modes.map(([m, t]) => el("button", { type: "button", "aria-pressed": String(m === cur), onclick: () => (set(m), render()) }, t)));

  function renderOrg(box: HTMLElement) {
    const Ls = live();
    const name = focus.org;
    const orgs = [...new Set(Ls.flatMap((l) => [l.from, l.to]).filter((n) => kindOf(n) === "organisation"))].sort();
    box.append(picker(orgs, "org", D.top.org));
    const A = around(name, Ls);
    box.append(
      el(
        "div",
        { class: "orghead" },
        el("span", { class: "nm" }, name),
        el("span", { class: "hint" }, `${plural(A.length, "name")}, ${plural(A.reduce((n, e) => n + e.links.length, 0), "link")}, up to chapter ${upto}`),
        modeTabs(
          [
            ["orbit", "Power map"],
            ["flow", "Money and parts"],
            ["time", "Who was there when"],
          ],
          orgMode,
          (m) => (orgMode = m),
        ),
      ),
      alsoLine(name, "org"),
    );
    if (!A.length) {
      box.append(el("p", { class: "empty" }, `Up to chapter ${upto}, the book links nobody to ${name}.`));
      return;
    }
    const s = el("div", { class: "stage-" + orgMode });
    box.append(s);
    ({ orbit: drawOrbit, flow: drawFlow, time: drawTimeline })[orgMode](s, name, A);
  }

  function legend(A: Around[], withPeople = true) {
    const cats = ORDER.filter((c) => CAT[c].side !== "people" && A.some((e) => e.cat === c && e.kind !== "person"));
    const ppl =
      withPeople && A.some((e) => e.kind === "person")
        ? [el("span", {}, el("i", { class: "sw ring", style: "--c:var(--person)" }), "People (hollow rings)"), el("span", {}, el("i", { class: "sw", style: "--c:var(--ink-500)" }), "Organisations (filled dots, coloured by link)")]
        : [];
    return el("div", { class: "legend" }, ppl, cats.map((c) => el("span", {}, el("i", { class: "sw", style: `--c:${CAT[c].color}` }), CAT[c].label)));
  }

  // A. Power map: the company at the centre, people on the inner ring, organisations on the outer ring.
  function drawOrbit(s: HTMLElement, X: string, A: Around[]) {
    const W = 1000;
    const H = 810;
    const cx = W / 2;
    const cy = H / 2;
    const R1 = 175;
    const R2 = 330;
    const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, class: "orbit", role: "img", "aria-label": `Power map of ${X}` });
    const people = A.filter((e) => e.kind === "person");
    const orgs = A.filter((e) => e.kind !== "person");
    const place = (list: Around[], R: number, start: number) =>
      list.forEach((e, i) => {
        const a = start + ((i + 0.5) * 2 * Math.PI) / list.length;
        e.x = cx + R * Math.cos(a);
        e.y = cy + R * Math.sin(a);
        e.a = a;
      });
    place(people, R1, -Math.PI / 2 - Math.PI * 0.35);
    place(orgs, R2, -Math.PI / 2 + 0.2);
    svg.append(S("circle", { cx, cy, r: R1, class: "ring" }), S("circle", { cx, cy, r: R2, class: "ring" }));
    const arcs = S("g");
    for (const c of ORDER) {
      const g = orgs.filter((e) => e.cat === c);
      if (!g.length) continue;
      const step = (2 * Math.PI) / orgs.length;
      const a0 = g[0].a - step / 2 + 0.02;
      const a1 = g[g.length - 1].a + step / 2 - 0.02;
      const p = (a: number) => `${cx + R2 * Math.cos(a)},${cy + R2 * Math.sin(a)}`;
      arcs.append(S("path", { d: `M${p(a0)} A${R2},${R2} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`, stroke: CAT[c].color, class: "catarc" }));
    }
    svg.append(arcs);
    const spokes = S("g");
    const nodes = S("g");
    const all = [...people, ...orgs];
    const maxN = Math.max(...all.map((e) => e.links.length));
    const pairs: { g: Element; sp: Element; e: Around }[] = [];
    const focusNode = (e: Around) =>
      pairs.forEach((p) => {
        p.g.classList.toggle(cls("dim"), p.e !== e);
        p.sp.classList.toggle(cls("dim"), p.e !== e);
      });
    for (const e of all) {
      const w = 1.2 + (3.5 * e.links.length) / maxN;
      const col = CAT[e.cat].color;
      const sp = S("line", { x1: cx, y1: cy, x2: e.x, y2: e.y, stroke: col, "stroke-width": w, class: "spoke" + (e.cat === "partner" ? " dashed" : "") });
      spokes.append(sp);
      const r = 7 + 9 * Math.sqrt(e.links.length / maxN);
      const right = Math.cos(e.a) >= -0.01;
      const lines = wrapWords(e.name, 18);
      const lx = e.x + (r + 7) * (right ? 1 : -1);
      const sub = CAT[e.cat].label + (e.role ? ` · ${e.role}` : "");
      const open = () => {
        focusNode(e);
        evidenceFor(X, e);
      };
      const g = S(
        "g",
        { class: "node", tabindex: 0, role: "button", "aria-label": `${e.name}: ${sub}`, onclick: open, onkeydown: (ev: KeyboardEvent) => ev.key === "Enter" && open() },
        S("circle", { cx: e.x, cy: e.y, r: r + 10, fill: "transparent" }),
        S("circle", { cx: e.x, cy: e.y, r, fill: e.kind === "person" ? "var(--paper-raised)" : col, stroke: col, "stroke-width": 2.5 }),
        S("text", { x: lx, y: e.y - (lines.length - 1) * 8 - 2, "text-anchor": right ? "start" : "end", class: "lbl" }, lines.map((t, i) => S("tspan", { x: lx, dy: i ? 16 : 0 }, t))),
        S("text", { x: lx, y: e.y + (lines.length - 1) * 8 + 14, "text-anchor": right ? "start" : "end", class: "sub" }, sub),
      );
      pairs.push({ g, sp, e });
      nodes.append(g);
    }
    svg.append(spokes, nodes);
    const cl = wrapWords(X, 14);
    svg.append(
      S("circle", { cx, cy, r: 74, class: "hub" }),
      S("text", { x: cx, y: cy - (cl.length - 1) * 11 + 6, "text-anchor": "middle", class: "hubtxt" }, cl.map((t, i) => S("tspan", { x: cx, dy: i ? 22 : 0 }, t))),
    );
    svg.append(S("text", { x: cx, y: cy - R1 - 12, "text-anchor": "middle", class: "ringlbl" }, "people"), S("text", { x: cx, y: cy - R2 - 14, "text-anchor": "middle", class: "ringlbl" }, "organisations"));
    s.append(legend(A), el("div", { class: "svgbox" }, svg));
  }

  // B. Money and parts: what flows in on the left, out on the right, family above and below, the people inside.
  function drawFlow(s: HTMLElement, X: string, A: Around[]) {
    const by = (side: string) => A.filter((e) => e.kind !== "person" || ["money_in", "money_out", "supplier", "customer"].includes(e.cat)).filter((e) => CAT[e.cat].side === side);
    const people = A.filter((e) => e.kind === "person" && CAT[e.cat].side === "people");
    const placed: { n: HTMLElement; e: Around }[] = [];
    const node = (e: Around) => {
      const n = el("button", { type: "button", class: "fnode", style: `--c:${CAT[e.cat].color}`, onclick: () => evidenceFor(X, e) }, el("b", {}, e.name), el("small", {}, `${CAT[e.cat].label} · ch ${e.first}${e.links.length > 1 ? ` · ${e.links.length}×` : ""}`));
      placed.push({ n, e });
      return n;
    };
    const col = (side: string, title: string) => {
      const list = by(side);
      return el("div", { class: "fcol fcol-" + side }, list.length ? el("div", { class: "fhead" }, title) : null, list.map(node));
    };
    const roleRow = (cat: string, title: string) => {
      const g = people.filter((e) => e.cat === cat);
      if (!g.length) return null;
      return el(
        "div",
        { class: "crow" },
        el("div", { class: "fhead" }, title),
        el("div", { class: cat === "leader" ? "succession" : "chips" }, g.map((e) => el("button", { type: "button", class: "chip person", onclick: () => evidenceFor(X, e) }, e.name, el("small", {}, (e.role ? e.role + " · " : "") + "ch " + e.first)))),
      );
    };
    const core = el("div", { class: "fcore" }, el("div", { class: "corename" }, X), roleRow("founder", "Founded by"), roleRow("leader", "Led by, in the book's order"), roleRow("staff", "Worked there"), roleRow("adviser", "Advised by"));
    const svg = S("svg", { class: "ribbons" });
    const grid = el("div", { class: "flow" }, svg, col("up", "Came from / owned by"), col("in", "Coming in"), core, col("out", "Going out"), col("down", "Offspring and purchases"));
    s.append(
      legend(
        A.filter((e) => e.kind !== "person" || CAT[e.cat].side !== "people"),
        false,
      ),
      grid,
    );
    const draw = () => {
      svg.replaceChildren();
      const r = grid.getBoundingClientRect();
      const c = core.getBoundingClientRect();
      svg.setAttribute("width", String(r.width));
      svg.setAttribute("height", String(r.height));
      const sides: Record<string, { n: HTMLElement; e: Around }[]> = { in: [], out: [], up: [], down: [] };
      placed.forEach((p) => sides[CAT[p.e.cat].side]?.push(p));
      for (const [side, list] of Object.entries(sides))
        list.forEach(({ n, e }, i) => {
          const b = n.getBoundingClientRect();
          const w = Math.min(14, 2 + 3 * e.links.length);
          const f = (i + 1) / (list.length + 1);
          let d: string;
          if (side === "in") {
            const x1 = b.right - r.left, y1 = b.top + b.height / 2 - r.top, x2 = c.left - r.left, y2 = c.top - r.top + c.height * (0.15 + 0.7 * f);
            d = `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
          } else if (side === "out") {
            const x1 = c.right - r.left, y1 = c.top - r.top + c.height * (0.15 + 0.7 * f), x2 = b.left - r.left, y2 = b.top + b.height / 2 - r.top;
            d = `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
          } else if (side === "up") {
            const x1 = b.left + b.width / 2 - r.left, y1 = b.bottom - r.top, x2 = c.left - r.left + c.width * (0.2 + 0.6 * f), y2 = c.top - r.top;
            d = `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
          } else {
            const x1 = c.left - r.left + c.width * (0.2 + 0.6 * f), y1 = c.bottom - r.top, x2 = b.left + b.width / 2 - r.left, y2 = b.top - r.top;
            d = `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
          }
          svg.append(S("path", { d, stroke: CAT[e.cat].color, "stroke-width": w, class: "ribbon" + (e.cat === "partner" ? " dashed" : "") }));
        });
    };
    requestAnimationFrame(draw);
    redraw = draw;
  }

  // C. Who was there when: one row per name, a mark for each chapter that links it to the company.
  function drawTimeline(s: HTMLElement, X: string, A: Around[]) {
    const narrow = narrowNow();
    const nameW = narrow ? 112 : 210;
    const top = 46;
    const rowH = narrow ? 28 : 38;
    const headH = 24;
    const avail = Math.max(240, width()) - nameW - 8;
    const cw = narrow ? avail / D.n : Math.max(12, avail / D.n);
    const W = nameW + D.n * cw + 8;
    const ms = Math.max(3.2, Math.min(6, cw * 0.62));
    const x = (ch: number) => nameW + (ch - 0.5) * cw;
    const groups = (
      [
        ["People", A.filter((e) => e.kind === "person")],
        ["Organisations", A.filter((e) => e.kind !== "person")],
      ] as [string, Around[]][]
    ).filter((g) => g[1].length);
    const H = top + groups.reduce((h, g) => h + headH + g[1].length * rowH, 0) + 10;
    const svg = S("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "timeline", role: "img", "aria-label": `Who was linked to ${X}, chapter by chapter` });
    PARTS.forEach(([c, n, t], i) => {
      const c2 = PARTS[i + 1]?.[0] || D.n + 1;
      svg.append(S("rect", { x: x(c) - cw / 2, y: 0, width: (c2 - c) * cw, height: H, class: i % 2 ? "band b1" : "band b0" }, S("title", {}, `Part ${n}: ${t}`)), S("text", { x: x(c) - cw / 2 + 3, y: 16, class: "partlbl" }, narrow ? n : `Part ${n}`));
    });
    for (let c = narrow ? 10 : 5; c <= D.n; c += narrow ? 10 : 5) svg.append(S("text", { x: x(c), y: 36, "text-anchor": "middle", class: "chlbl" }, c));
    if (upto < D.n) svg.append(S("rect", { x: x(upto + 1) - cw / 2, y: 0, width: (D.n - upto) * cw, height: H, class: "unread" }), S("text", { x: x(upto + 1) - cw / 2 + 6, y: H - 10, class: "chlbl" }, "not read yet"));
    svg.append(S("line", { x1: x(upto) + cw / 2, x2: x(upto) + cw / 2, y1: 22, y2: H, class: "nowline" }));
    const SHAPE: Record<string, string> = { founded: "diamond", led: "disc", worked_at: "ring", hired: "ring", left: "cross", advised: "square" };
    let y = top;
    for (const [title, list] of groups) {
      svg.append(S("text", { x: 4, y: y + 16, class: "grouplbl" }, title.toUpperCase()));
      y += headH;
      for (const e of list) {
        const cy = y + rowH / 2;
        const col = CAT[e.cat].color;
        const nm = S(
          "text",
          { x: nameW - 10, y: narrow ? cy + 1 : cy - 5, "text-anchor": "end", class: "rowname", role: "button", tabindex: 0, onclick: () => evidenceFor(X, e) },
          e.name.length > (narrow ? 13 : 28) ? e.name.slice(0, narrow ? 11 : 27) + "…" : e.name,
          S("title", {}, e.name),
        );
        svg.append(S("line", { x1: 0, x2: W, y1: y + rowH, y2: y + rowH, class: "rowrule" }), nm);
        if (!narrow) svg.append(S("text", { x: nameW - 10, y: cy + 11, "text-anchor": "end", class: "rowsub" }, (CAT[e.cat].label + (e.role ? ` · ${e.role}` : "")).slice(0, 34)));
        if (e.last > e.first) svg.append(S("line", { x1: x(e.first), x2: x(e.last), y1: cy, y2: cy, stroke: col, class: "span" }));
        const byCh = new Map<number, L[]>();
        for (const l of e.links) byCh.set(l.chapter, [...(byCh.get(l.chapter) ?? []), l]);
        for (const [ch, ls] of byCh) {
          const rel = ["founded", "led", "left", "advised"].find((r) => ls.some((l) => l.relation === r)) || ls[0].relation;
          const sh = e.kind === "person" ? SHAPE[rel] || "ring" : "disc";
          const m = x(ch);
          const z = ms;
          const mark =
            sh === "diamond"
              ? S("path", { d: `M${m},${cy - z - 1} L${m + z + 1},${cy} L${m},${cy + z + 1} L${m - z - 1},${cy} Z`, fill: col })
              : sh === "disc"
                ? S("circle", { cx: m, cy, r: z - 0.5, fill: col })
                : sh === "cross"
                  ? S("path", { d: `M${m - z + 1},${cy - z + 1} L${m + z - 1},${cy + z - 1} M${m + z - 1},${cy - z + 1} L${m - z + 1},${cy + z - 1}`, stroke: col, "stroke-width": 2.5 })
                  : sh === "square"
                    ? S("rect", { x: m - z + 1, y: cy - z + 1, width: 2 * z - 2, height: 2 * z - 2, fill: "var(--paper)", stroke: col, "stroke-width": 2 })
                    : S("circle", { cx: m, cy, r: z - 1.5, fill: "var(--paper)", stroke: col, "stroke-width": 2.2 });
          svg.append(
            S(
              "g",
              { class: "mark", role: "button", tabindex: 0, onclick: () => openEvidence(`${e.name} and ${X}, chapter ${ch}`, ls, goButtons(e.name)) },
              S("rect", { x: m - cw / 2, y: y + 2, width: cw, height: rowH - 4, fill: "transparent" }),
              mark,
              S("title", {}, `Chapter ${ch}: ${ls.map(sentence).join("; ")}`),
            ),
          );
        }
        y += rowH;
      }
    }
    const icon = (k: string) =>
      S(
        "svg",
        { width: 14, height: 14, viewBox: "0 0 14 14" },
        k === "founded"
          ? S("path", { d: "M7,1 L13,7 L7,13 L1,7 Z", fill: "var(--person)" })
          : k === "led"
            ? S("circle", { cx: 7, cy: 7, r: 5.5, fill: "var(--person)" })
            : k === "worked there"
              ? S("circle", { cx: 7, cy: 7, r: 4.8, fill: "none", stroke: "var(--person)", "stroke-width": 2.2 })
              : k === "left"
                ? S("path", { d: "M2,2 L12,12 M12,2 L2,12", stroke: "var(--person)", "stroke-width": 2.5 })
                : S("rect", { x: 2, y: 2, width: 10, height: 10, fill: "none", stroke: "var(--person)", "stroke-width": 2 }),
      );
    const key = el(
      "div",
      { class: "legend" },
      ["founded", "led", "worked there", "left", "advised"].map((k) => el("span", {}, icon(k), k)),
    );
    s.append(
      key,
      el("div", { class: "tlbox" }, svg),
    );
  }

  // ---------- one person: their life in the order it happened ----------
  const linkCount = (p: string) => D.links.filter((l) => l.from === p || l.to === p).length;
  /** The person's events, visible up to the slider, each worded from the direction of its own links. */
  function lifeOf(p: string) {
    const raw = linkCount(p) >= minLinks ? D.lives[p] : null;
    const evs: (Omit<Step, "ls" | "other" | "kind" | "verb" | "rel" | "first">)[] = raw
      ? raw.map((e, i) => ({ ...e, i }))
      : D.links
          .map((l, i) => ({ l, i }))
          .filter((x) => x.l.from === p || x.l.to === p)
          .sort((a, b) => a.l.chapter - b.l.chapter)
          .map((x, i) => ({ what: x.l.relation, with: x.l.from === p ? x.l.to : x.l.from, role: x.l.role, links: [x.i], date_ids: [], basis: "unknown" as const, start_year: null, end_year: null, order_chapter: null, order_quote: null, order_cfi: null, why: "Not rebuilt (below your setting): shown in the book's order.", gk: null, i }));
    const steps: Step[] = [];
    for (const e of evs) {
      const ls = e.links.map((i) => D.links[i]).filter((l) => l && l.chapter <= upto);
      if (!ls.length) continue;
      const l0 = ls[0];
      const active = l0.from === p;
      const rel = l0.relation;
      const other = active ? l0.to : l0.from;
      steps.push({ ...e, ls, other, kind: kindOf(other), verb: active ? ACTIVE[rel] || rel : PASSIVE[rel] || `${ACTIVE[rel] || rel} (by)`, rel, first: Math.min(...ls.map((l) => l.chapter)) });
    }
    return { events: steps, rebuilt: !!raw };
  }
  const yearText = (e: Step) => (e.start_year ? span(e.start_year, e.end_year) : showGK && e.gk?.start_year ? span(e.gk.start_year, e.gk.end_year) : "");
  const yearKind = (e: Step) => (e.start_year ? "book" : showGK && e.gk?.start_year ? "gk" : "none");
  function eventEvidence(p: string, e: Step) {
    openEvidence(`${p}: ${e.verb} ${e.other}`, e.ls, goButtons(e.other));
    const add: Node[] = [];
    add.push(
      el(
        "div",
        { class: "ev-item" },
        el("div", { class: "s" }, "When: ", e.start_year ? `${e.start_year}${e.end_year && e.end_year !== e.start_year ? "–" + e.end_year : ""}` : "no year in the book", el("span", { class: "badge " + (BASIS[e.basis]?.[1] ?? "") }, BASIS[e.basis]?.[0] || e.basis)),
        el("div", { class: "meta" }, e.why || ""),
      ),
    );
    if (e.gk?.start_year || e.gk?.note)
      add.push(
        el(
          "div",
          { class: "ev-item gkitem" },
          el("div", { class: "s" }, "From general knowledge, not the book: ", e.gk.start_year ? span(e.gk.start_year, e.gk.end_year) : "no year", el("span", { class: "badge b-gk" }, `${e.gk.confidence || ""} confidence`)),
          e.gk.note ? el("div", { class: "meta" }, e.gk.note) : null,
          el("div", { class: "meta" }, "Claude's own knowledge, not checked against the book or a source."),
        ),
      );
    for (const d of e.date_ids) {
      const f = D.dates[d];
      if (f) add.push(el("div", { class: "ev-item" }, el("div", { class: "s" }, `The year: ${f.year}${f.end_year ? "–" + f.end_year : ""}`), el("blockquote", {}, f.quote), el("div", { class: "meta" }, where(f.chapter)), goTo(f.cfi)));
    }
    if (e.order_quote) add.push(el("div", { class: "ev-item" }, el("div", { class: "s" }, "The order"), el("blockquote", {}, e.order_quote), el("div", { class: "meta" }, e.order_chapter ? where(e.order_chapter) : ""), goTo(e.order_cfi)));
    dbody.querySelector("h3")?.after(...add);
  }

  function renderPerson(box: HTMLElement) {
    const Ls = live();
    const name = focus.person;
    const people = [...new Set(Ls.flatMap((l) => [l.from, l.to]).filter((n) => kindOf(n) === "person"))].sort();
    box.append(picker(people, "person", D.top.person));
    const { events, rebuilt } = lifeOf(name);
    const dated = events.filter((e) => e.start_year).length;
    const gkd = events.filter((e) => !e.start_year && e.gk?.start_year).length;
    const n = linkCount(name);
    box.append(
      el(
        "div",
        { class: "orghead" },
        el("span", { class: "nm" }, name),
        el("span", { class: "hint" }, events.length ? (rebuilt ? `${plural(events.length, "life event")}, in the order they happened · ${dated} dated by the book${showGK && gkd ? ` · ${gkd} from general knowledge` : ""}` : `${plural(events.length, "link")}, in the book's order`) : ""),
        modeTabs(
          [
            ["story", "Storyline"],
            ["read", "Read vs happened"],
            ["list", "List"],
          ],
          personMode,
          (m) => (personMode = m),
        ),
      ),
      alsoLine(name, "person"),
    );
    if (!events.length) {
      box.append(el("p", { class: "empty" }, `Up to chapter ${upto}, the book links ${name || "this person"} to nobody.`));
      return;
    }
    const seg = <T>(label: string, choices: [T, string][], cur: T, set: (v: T) => void) =>
      el("div", { class: "setting" }, el("span", {}, label), el("div", { class: "tabs small", role: "group", "aria-label": label }, choices.map(([v, t]) => el("button", { type: "button", "aria-pressed": String(v === cur), onclick: () => (set(v), render()) }, t))));
    box.append(
      el(
        "div",
        { class: "settings" },
        seg<number>(
          "Rebuild a life when the book links the person at least",
          [1, 2, 3, 5].map((v) => [v, v === 1 ? "1 time" : `${v} times`]),
          minLinks,
          (v) => (minLinks = v),
        ),
        seg<boolean>(
          "Years the book leaves out",
          [
            [true, "Fill from general knowledge"],
            [false, "Leave blank"],
          ],
          showGK,
          (v) => (showGK = v),
        ),
        ),
    );
    if (!rebuilt)
      box.append(
        !D.lives[name]
          ? el("div", { class: "banner" }, `${name}'s life was not rebuilt, so this is the book's order, not the order things happened.`)
          : el("div", { class: "banner" }, `${name}: the book links them ${n} time${n === 1 ? "" : "s"}, below your setting of ${minLinks}, so this is the book's order, not the order things happened. `, el("button", { type: "button", class: "chip", onclick: () => ((minLinks = Math.min(minLinks, n)), render()) }, `Rebuild ${name} anyway`)),
      );
    const s = el("div");
    box.append(s);
    ({ story: drawStory, read: drawReadVsHappened, list: drawLifeList })[personMode](s, name, events);
  }

  // A. Storyline: one lane per organisation; the person's line moves between lanes as their life does.
  function drawStory(s: HTMLElement, p: string, E: Step[]) {
    const narrow = narrowNow();
    const laneW = 14;
    const n = E.length;
    const avail = width() - 2;
    const colW = Math.max(narrow ? 84 : 76, (avail - laneW - 24) / n);
    const laneH = narrow ? 100 : 104;
    const top = 40;
    const lanes: string[] = [];
    let cur: string | null = null;
    const at: string[] = [];
    for (const e of E) {
      if (e.kind === "organisation") {
        if (!lanes.includes(e.other)) lanes.push(e.other);
        cur = e.other;
      }
      at.push(cur ?? e.other);
      if (cur == null && !lanes.includes(e.other)) lanes.push(e.other);
    }
    const W = laneW + n * colW + 24;
    const H = top + lanes.length * laneH + 34;
    const x = (i: number) => laneW + (i + 0.5) * colW;
    const y = (lane: string) => top + lanes.indexOf(lane) * laneH + laneH / 2;
    const svg = S("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "story", role: "img", "aria-label": `${p}'s life as a storyline` });
    lanes.forEach((ln, k) => {
      svg.append(S("rect", { x: 0, y: top + k * laneH, width: W, height: laneH, class: k % 2 ? "lane l1" : "lane l0" }));
      svg.append(S("text", { x: 10, y: top + (k + 1) * laneH - 9, class: "lanelbl" + (kindOf(ln) === "person" ? " pl" : ""), role: "button", tabindex: 0, onclick: () => show(kindOf(ln) === "person" ? "person" : "org", ln) }, ln));
    });
    E.forEach((e, i) => svg.append(S("text", { x: x(i), y: 22, "text-anchor": "middle", class: "yr " + yearKind(e) }, yearText(e) || "·")));
    // Fellow travellers: others whose rebuilt lives put them in the same organisation at the same time.
    const others: { ln: string; cols: number[]; q: string; n: number; how: string; k: number }[] = [];
    for (const ln of lanes.filter((l) => kindOf(l) === "organisation")) {
      const cols = at.map((a, i) => (a === ln ? i : -1)).filter((i) => i >= 0);
      if (!cols.length) continue;
      const mates: { q: string; n: number; how: string }[] = [];
      for (const [q, evs] of Object.entries(D.lives)) {
        if (q === p) continue;
        const here = evs.filter((e) => e.with === ln && ["founded", "worked_at", "led"].includes(e.what) && e.links.some((i) => D.links[i]?.chapter <= upto));
        if (!here.length) continue;
        const mine = E.filter((_, i) => at[i] === ln);
        const theirs = here.map((e) => [e.start_year, e.end_year || e.start_year]).filter((v): v is [number, number] => !!v[0]);
        const myYears = mine.map((e) => [e.start_year, e.end_year || e.start_year]).filter((v): v is [number, number] => !!v[0]);
        const overlap = theirs.length && myYears.length && theirs.some(([a, b]) => myYears.some(([c, d]) => a <= d + 1 && c <= b + 1));
        const cofound = here.some((e) => e.what === "founded") && mine.some((e) => e.rel === "founded");
        const met = D.links.some((l) => l.chapter <= upto && ((l.from === p && l.to === q) || (l.from === q && l.to === p)));
        if (!(overlap || (!(theirs.length && myYears.length) && (cofound || met)))) continue;
        mates.push({ q, n: here.reduce((t, e) => t + e.links.length, 0), how: here[0].what });
      }
      mates
        .sort((a, b) => b.n - a.n)
        .slice(0, narrow ? 2 : 3)
        .forEach((m, k) => others.push({ ln, cols, ...m, k }));
    }
    for (const o of others) {
      const yy = y(o.ln) - (15 + 13 * o.k);
      const x0 = x(o.cols[0]) - colW * 0.42;
      const x1 = x(o.cols[o.cols.length - 1]) + colW * 0.42;
      svg.append(
        S(
          "g",
          { class: "mate", role: "button", tabindex: 0, onclick: () => show("person", o.q) },
          S("path", { d: `M${x0},${yy} L${x1},${yy}`, class: "mateline" }),
          S("text", { x: x1 - 2, y: yy - 4, "text-anchor": "end", class: "matelbl" }, o.q),
          S("title", {}, `${o.q} was also at ${o.ln} (${o.how.replace("_", " ")}). Tap to see their path.`),
        ),
      );
    }
    let d = "";
    E.forEach((_, i) => {
      const X = x(i);
      const Y = y(at[i]);
      if (!i) d = `M${X - colW * 0.45},${Y} L${X},${Y}`;
      else {
        const pX = x(i - 1);
        const pY = y(at[i - 1]);
        const m = (pX + X) / 2;
        d += ` C${m},${pY} ${m},${Y} ${X},${Y}`;
      }
    });
    d += ` L${x(n - 1) + colW * 0.45},${y(at[n - 1])}`;
    svg.append(S("path", { d, class: "lifeline" }));
    E.forEach((e, i) => {
      const X = x(i);
      const Y = y(at[i]);
      const z = 7;
      const dated = !!e.start_year;
      const cls = " stop" + (dated ? " dated" : yearKind(e) === "gk" ? " gk" : "");
      const shape =
        e.rel === "founded"
          ? S("path", { d: `M${X},${Y - z - 2} L${X + z + 2},${Y} L${X},${Y + z + 2} L${X - z - 2},${Y} Z`, class: cls })
          : e.rel === "left"
            ? S("path", { d: `M${X - z},${Y - z} L${X + z},${Y + z} M${X + z},${Y - z} L${X - z},${Y + z}`, class: "x" + cls })
            : e.kind === "person"
              ? S("rect", { x: X - z + 1, y: Y - z + 1, width: 2 * z - 2, height: 2 * z - 2, rx: 2, class: cls })
              : S("circle", { cx: X, cy: Y, r: z, class: cls });
      const label = wrapWords(`${e.verb} ${e.kind === "person" ? e.other : ""}`.trim(), Math.max(10, Math.floor(colW / 7)));
      svg.append(
        S(
          "g",
          { class: "mark", role: "button", tabindex: 0, onclick: () => eventEvidence(p, e), onkeydown: (ev: KeyboardEvent) => ev.key === "Enter" && eventEvidence(p, e) },
          S("rect", { x: X - colW / 2, y: Y - 26, width: colW, height: 52, fill: "transparent" }),
          shape,
          S("text", { x: X, y: Y + 24, "text-anchor": "middle", class: "evlbl" }, label.map((t, k) => S("tspan", { x: X, dy: k ? 13 : 0 }, t))),
          S("title", {}, `${e.verb} ${e.other}${yearText(e) ? ", " + yearText(e) : ""} (${BASIS[e.basis]?.[0] || ""})`),
        ),
      );
    });
    const key = el(
      "div",
      { class: "legend" },
      el("span", {}, el("b", { class: "yrk" }, "1987"), " year from the book"),
      showGK ? el("span", {}, el("b", { class: "yrk gk" }, "1957"), " general knowledge, not the book") : null,
      el("span", {}, el("b", { class: "yrk none" }, "·"), " no year: placed by the book's order"),
      el("span", {}, el("i", { class: "sw", style: "--c:var(--ink-900)" }), "solid stop: dated"),
      el("span", {}, el("i", { class: "sw hollow" }), "hollow: not dated"),
      el("span", {}, el("i", { class: "mt" }), "others at the same place"),
    );
    s.append(
      key,
      el("div", { class: "tlbox story-box" }, svg),
    );
  }

  // B. Where you read it vs when it happened: chapters on top, the life in order below, a line for each telling.
  function drawReadVsHappened(s: HTMLElement, p: string, E: Step[]) {
    const narrow = narrowNow();
    const W = Math.max(narrow ? 640 : 900, width() - 2);
    const padL = 20;
    const padR = 20;
    const yTop = 58;
    const yBot = narrow ? 300 : 340;
    const H = yBot + 96;
    const cx = (ch: number) => padL + ((ch - 0.5) * (W - padL - padR)) / D.n;
    const ex = (i: number) => padL + ((i + 0.5) * (W - padL - padR)) / E.length;
    const svg = S("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "rvh", role: "img", "aria-label": "Where the book tells each step against when it happened" });
    svg.append(S("text", { x: padL, y: 18, class: "axlbl" }, `WHERE YOU READ IT (chapters 1–${D.n})`), S("text", { x: padL, y: yBot + 84, class: "axlbl" }, "WHEN IT HAPPENED (their life, in order)"));
    PARTS.forEach(([c, n], i) => {
      const c2 = PARTS[i + 1]?.[0] || D.n + 1;
      svg.append(S("rect", { x: cx(c) - (W - 40) / (2 * D.n), y: 26, width: ((c2 - c) * (W - padL - padR)) / D.n, height: 16, class: i % 2 ? "band b1" : "band b0" }), S("text", { x: cx(c) - (W - 40) / (2 * D.n) + 3, y: 38, class: "partlbl" }, n));
    });
    svg.append(S("line", { x1: padL, x2: W - padR, y1: yTop - 8, y2: yTop - 8, class: "axis" }), S("line", { x1: padL, x2: W - padR, y1: yBot + 8, y2: yBot + 8, class: "axis" }));
    if (upto < D.n) svg.append(S("rect", { x: cx(upto + 1) - (W - 40) / (2 * D.n), y: 26, width: W - padR - cx(upto + 1), height: 16, class: "unread" }));
    const lines = S("g");
    const marks = S("g");
    const hi = (k: number | null) => lines.querySelectorAll("path").forEach((pth) => pth.classList.toggle(cls("dim"), k != null && Number(pth.getAttribute("data-e")) !== k));
    E.forEach((e, i) => {
      const col = e.kind === "person" ? "var(--person)" : `hsl(${(i * 47) % 360} 38% 45%)`;
      for (const l of e.ls) lines.append(S("path", { d: `M${cx(l.chapter)},${yTop} C${cx(l.chapter)},${(yTop + yBot) / 2} ${ex(i)},${(yTop + yBot) / 2} ${ex(i)},${yBot}`, class: "rvhline", stroke: col, "data-e": i }));
      for (const l of e.ls) marks.append(S("circle", { cx: cx(l.chapter), cy: yTop, r: 3.5, fill: col }));
      const lbl = wrapWords(`${e.verb} ${e.other}`, narrow ? 11 : 14).slice(0, 3);
      marks.append(
        S(
          "g",
          { class: "mark", role: "button", tabindex: 0, onclick: () => eventEvidence(p, e), onmouseenter: () => hi(i), onmouseleave: () => hi(null), onfocus: () => hi(i) },
          S("circle", { cx: ex(i), cy: yBot, r: 6.5, fill: e.start_year ? col : "var(--paper)", stroke: col, "stroke-width": 2.5 }),
          S("text", { x: ex(i), y: yBot + 26, "text-anchor": "middle", class: "yr " + yearKind(e) }, yearText(e) || "·"),
          S("text", { x: ex(i), y: yBot + 42, "text-anchor": "middle", class: "evlbl" }, lbl.map((t, k) => S("tspan", { x: ex(i), dy: k ? 12 : 0 }, t))),
        ),
      );
    });
    svg.append(lines, marks);
    let back = 0;
    E.forEach((e, i) =>
      E.forEach((f, j) => {
        if (j > i && f.first < e.first) back++;
      }),
    );
    s.append(
      el("p", { class: "hint" }, `Crossing lines: the book tells a later step first${back ? ` (${back} here)` : " (none here)"}.`),
      el("div", { class: "tlbox" }, svg),
    );
  }

  // C. The plain list, in true order, with how each step was placed.
  function drawLifeList(s: HTMLElement, p: string, E: Step[]) {
    const ol = el("ol", { class: "path" });
    for (const e of E) {
      ol.append(
        el(
          "li",
          { class: e.kind === "organisation" ? "org" : "" },
          el(
            "div",
            { class: "ch" },
            yearText(e) ? el("b", { class: "yrinline " + yearKind(e) }, yearText(e)) : "",
            " ",
            yearKind(e) === "gk" ? el("span", { class: "badge b-gk" }, "year from general knowledge") : null,
            " ",
            el("span", { class: "badge " + (BASIS[e.basis]?.[1] ?? "") }, BASIS[e.basis]?.[0] || e.basis),
            ` · told in chapter${e.ls.length > 1 ? "s" : ""} ${[...new Set(e.ls.map((l) => l.chapter))].join(", ")}`,
          ),
          el("div", { class: "what" }, e.verb, " ", el("button", { type: "button", onclick: () => show(e.kind === "person" ? "person" : "org", e.other) }, e.other), e.role ? ` (${e.role})` : ""),
          el("q", {}, e.ls[0].quote),
          el("div", { class: "hint" }, e.why || ""),
          el("button", { type: "button", class: "ev", onclick: () => eventEvidence(p, e) }, "where the book says it, and how it was placed"),
        ),
      );
    }
    s.append(ol);
  }

  // ---------- shared ----------
  function picker(names: string[], v: GenealogyTop, sugg: string[]) {
    const id = "gn-dl-" + v;
    const inp = el("input", { list: id, placeholder: v === "person" ? "Find a person" : "Find an organisation", "aria-label": "Find a name" }) as HTMLInputElement;
    inp.addEventListener("change", () => names.includes(inp.value) && show(v, inp.value));
    return el(
      "div",
      { class: "pick" },
      inp,
      el("datalist", { id }, names.map((n) => el("option", { value: n }))),
      el("div", { class: "sugg" }, sugg.filter((n) => names.includes(n)).map((n) => el("button", { type: "button", class: "chip " + kindOf(n), "aria-pressed": String(n === focus[v]), onclick: () => show(v, n) }, n))),
    );
  }
  function render() {
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === view)));
    out.textContent = `${upto}. ${D.chapters[upto] ?? ""}`;
    back.hidden = upto === D.at;
    redraw = null;
    stage.replaceChildren();
    ({ tree: renderTree, org: renderOrg, person: renderPerson })[view](stage);
  }
  const onResize = () => redraw?.();
  window.addEventListener("resize", onResize);
  render();
  return () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    root.replaceChildren();
  };
}
