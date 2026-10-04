import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { DOMParser } from "linkedom";

/**
 * The section model (M4): every EPUB split into chapters → sections →
 * paragraphs, each with a stable id and an EPUB CFI (a standard address for a
 * spot in the book). The AI features (M6+) work on these; highlights (M5)
 * attach to them through the anchor model (ground rule 4).
 *
 * Ids are derived only from the file's content (chapter path, position and a
 * hash of the text), so importing the same file again gives the same ids.
 */
export type SectionKind = "chapter" | "section" | "paragraph";

export type Section = {
  id: string;
  kind: SectionKind;
  parentId: string | null;
  position: number;
  chapterIndex: number;
  href: string;
  cfi: string;
  label: string;
  text: string;
};

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  preserveOrder: false,
  isArray: (name) => ["item", "itemref", "rootfile"].includes(name),
});

const hash = (s: string, n = 12) => createHash("sha1").update(s).digest("hex").slice(0, n);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function resolve(base: string, href: string): string {
  const parts = (base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "").split("/").filter(Boolean);
  for (const seg of decodeURIComponent(href.split("#")[0]).split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

// Block elements that hold readable text. A "leaf" block contains no other block.
const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre", "blockquote", "dd", "dt", "figcaption", "td", "th"]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
type El = { tagName: string; localName?: string; id?: string; children: ArrayLike<El>; parentElement: El | null; textContent: string | null; getAttribute(n: string): string | null };
const tag = (el: El) => (el.localName ?? el.tagName).toLowerCase().replace(/^.*:/, "");

/** CFI steps for an element, from the document root, the way foliate-js writes them. */
function elementSteps(el: El, root: El): string {
  const steps: string[] = [];
  let node: El | null = el;
  while (node && node !== root) {
    const parent: El | null = node.parentElement;
    if (!parent) break;
    const index = Array.from(parent.children).indexOf(node);
    steps.unshift(`/${(index + 1) * 2}${node.id ? `[${node.id}]` : ""}`);
    node = parent;
  }
  return steps.join("");
}

export function extractSections(bytes: Uint8Array, toc: { label: string; href: string }[] = []): Section[] {
  const files = unzipSync(bytes);
  const container = files["META-INF/container.xml"];
  if (!container) return [];
  const opfPath: string = xml.parse(strFromU8(container))?.container?.rootfiles?.rootfile?.[0]?.["@full-path"];
  if (!opfPath || !files[opfPath]) return [];

  // The package document, parsed as a DOM so spine positions match foliate's CFIs.
  const opfDoc = new DOMParser().parseFromString(strFromU8(files[opfPath]), "text/xml");
  const pkg = opfDoc.documentElement as unknown as El;
  const spineEl = Array.from(pkg.children).find((c) => tag(c) === "spine");
  const manifestEl = Array.from(pkg.children).find((c) => tag(c) === "manifest");
  if (!spineEl || !manifestEl) return [];
  const spineStep = `/${(Array.from(pkg.children).indexOf(spineEl) + 1) * 2}`;
  const manifest = new Map(
    Array.from(manifestEl.children).map((i) => [i.getAttribute("id"), { href: i.getAttribute("href") ?? "", type: i.getAttribute("media-type") ?? "" }]),
  );
  const tocLabel = new Map<string, string>();
  for (const t of toc) {
    const file = t.href.split("#")[0];
    if (!tocLabel.has(file)) tocLabel.set(file, clean(t.label));
  }

  const out: Section[] = [];
  let position = 0;
  Array.from(spineEl.children).forEach((itemref, spineIndex) => {
    if (tag(itemref) !== "itemref" || itemref.getAttribute("linear") === "no") return;
    const item = manifest.get(itemref.getAttribute("idref"));
    if (!item || !/xhtml|html/.test(item.type)) return;
    const href = resolve(opfPath, item.href);
    const source = files[href];
    if (!source) return;
    const doc = new DOMParser().parseFromString(strFromU8(source), "text/xml");
    const root = doc.documentElement as unknown as El;
    if (!root || tag(root) !== "html") return;
    const base = `${spineStep}/${(spineIndex + 1) * 2}${itemref.id ? `[${itemref.id}]` : ""}`;
    const cfiOf = (el: El) => `epubcfi(${base}!${elementSteps(el, root)})`;

    const blocks: El[] = [];
    const walk = (el: El) => {
      for (const child of Array.from(el.children)) {
        const t = tag(child);
        if (["script", "style", "nav", "aside"].includes(t)) continue;
        if (BLOCKS.has(t) && !hasBlock(child)) blocks.push(child);
        else walk(child);
      }
    };
    const hasBlock = (el: El): boolean => Array.from(el.children).some((c) => BLOCKS.has(tag(c)) || hasBlock(c));
    const body = Array.from(root.children).find((c) => tag(c) === "body");
    if (!body) return;
    walk(body);

    const texts = blocks.map((b) => ({ el: b, t: tag(b), text: clean(b.textContent ?? "") })).filter((b) => b.text);
    if (!texts.length) return;
    const firstHeading = texts.find((b) => HEADINGS.has(b.t));
    const chapterLabel = tocLabel.get(href) ?? firstHeading?.text ?? `Part ${spineIndex + 1}`;
    const chapterId = `c-${hash(href, 10)}`;
    out.push({ id: chapterId, kind: "chapter", parentId: null, position: position++, chapterIndex: spineIndex, href, cfi: `epubcfi(${base})`, label: chapterLabel, text: "" });

    let parent = chapterId;
    let n = 0;
    for (const b of texts) {
      n += 1;
      const isTitle = b === firstHeading && clean(b.text) === clean(chapterLabel);
      if (HEADINGS.has(b.t) && !isTitle) {
        const id = `s-${hash(`${chapterId}|${n}|${b.text}`)}`;
        out.push({ id, kind: "section", parentId: chapterId, position: position++, chapterIndex: spineIndex, href, cfi: cfiOf(b.el), label: b.text, text: "" });
        parent = id;
      } else if (!isTitle) {
        const id = `p-${hash(`${chapterId}|${n}|${b.text}`)}`;
        out.push({ id, kind: "paragraph", parentId: parent, position: position++, chapterIndex: spineIndex, href, cfi: cfiOf(b.el), label: "", text: b.text });
      }
    }
  });
  return out;
}
