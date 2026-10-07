import { strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { DOMParser } from "linkedom";
import { PDFDocument } from "pdf-lib";
import { safeUnzip, ZipError } from "../readalong/zipread";

/**
 * Reads what we need from an uploaded book: type, title, author, cover and
 * table of contents. Ground rule 1: DRM-protected files are refused, never
 * unlocked.
 */
export class ImportError extends Error {}

export type TocEntry = { label: string; href: string; children: TocEntry[] };

export type BookInfo = {
  type: "epub" | "pdf";
  title: string;
  author: string;
  language: string | null;
  publisher: string | null;
  description: string | null;
  pageCount: number | null;
  cover: { data: Uint8Array; contentType: string; ext: string } | null;
  toc: TocEntry[];
};

export const MAX_BOOK_BYTES = 200 * 1024 * 1024;

const MB = 1024 * 1024;

/**
 * Limits on what an uploaded EPUB may unpack to. An EPUB is a zip file, and
 * a "zip bomb" is a small zip that unpacks to gigabytes (a zip of 524,030
 * bytes can unpack to 512 MB of zeros). So EPUBs are unpacked with
 * `safeUnzip` (lib/readalong/zipread.ts, as read-along packages are), which
 * reads the zip's own table of contents and refuses it before unpacking
 * anything when these limits are passed, and stops at once any file that
 * unpacks to more than it declared.
 *
 * Chosen from the evidence (2026-10-07), with room to spare:
 * - uploads are capped at 200 MB (MAX_BOOK_BYTES);
 * - the three sample books (Standard Ebooks) hold 24 to 48 files and
 *   unpack to 2.06 to 2.27 times their size (262,771 to 596,490 bytes);
 * - the largest EPUB in the live library (backup of 2026-10-06) is one of
 *   them, Frankenstein: 271,904 bytes, 48 files.
 * Pictures, the bulk of any large EPUB, are already compressed and unpack to
 * about their own size. Even a book at the 200 MB cap that unpacked as much
 * as the samples do (2.27 times) would come to 454 MB, under 512 MB. 10,000
 * files is about 200 times the largest sample.
 */
export const EPUB_ZIP_LIMITS = { maxUnpacked: 512 * MB, maxEntries: 10_000 };

/** Unpacks an EPUB within EPUB_ZIP_LIMITS. Anything refused becomes an ImportError in plain words. */
export function unzipEpub(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return safeUnzip(bytes, EPUB_ZIP_LIMITS);
  } catch (e) {
    const why = e instanceof ZipError ? e.message : "";
    if (why === "too large") {
      throw new ImportError(`This EPUB would unpack to more than ${EPUB_ZIP_LIMITS.maxUnpacked / MB} MB, far more than any real book, so it was not added.`);
    }
    if (why === "too many entries") {
      throw new ImportError(`This EPUB holds more than ${EPUB_ZIP_LIMITS.maxEntries.toLocaleString("en-US")} files, far more than any real book, so it was not added.`);
    }
    throw new ImportError("This file is not a readable EPUB.");
  }
}

export function detectType(bytes: Uint8Array): "epub" | "pdf" | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf"; // %PDF
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "epub"; // PK (zip); confirmed by the mimetype file
  return null;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  textNodeName: "#text",
  isArray: (name) => ["item", "itemref", "meta", "creator", "title", "EncryptedData", "rootfile", "reference"].includes(name),
});

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).trim();
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return text((v as Record<string, unknown>)["#text"]);
  return "";
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function resolve(base: string, href: string): string {
  const parts = (base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "").split("/").filter(Boolean);
  for (const seg of decodeURIComponent(href.split("#")[0]).split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

// Font obfuscation is allowed (it is not DRM); anything else encrypted is.
const FONT_OBFUSCATION = ["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"];

export function parseEpub(bytes: Uint8Array): BookInfo {
  const files = unzipEpub(bytes);
  if (files["mimetype"] && !strFromU8(files["mimetype"]).startsWith("application/epub+zip")) {
    throw new ImportError("This zip file is not an EPUB.");
  }
  if (files["META-INF/rights.xml"]) throw new ImportError("This EPUB is DRM-protected. Only DRM-free books can be added.");
  if (files["META-INF/encryption.xml"]) {
    const enc = xml.parse(strFromU8(files["META-INF/encryption.xml"]));
    const algorithms: string[] = (enc?.encryption?.EncryptedData ?? []).map(
      (d: { EncryptionMethod?: { "@Algorithm"?: string } }) => d?.EncryptionMethod?.["@Algorithm"] ?? "",
    );
    if (algorithms.some((a) => !FONT_OBFUSCATION.includes(a))) {
      throw new ImportError("This EPUB is DRM-protected. Only DRM-free books can be added.");
    }
  }
  const container = files["META-INF/container.xml"];
  if (!container) throw new ImportError("This EPUB is missing its container file.");
  const opfPath: string = xml.parse(strFromU8(container))?.container?.rootfiles?.rootfile?.[0]?.["@full-path"];
  if (!opfPath || !files[opfPath]) throw new ImportError("This EPUB is missing its package file.");
  const pkg = xml.parse(strFromU8(files[opfPath]))?.package ?? {};
  const meta = pkg.metadata ?? {};
  const items: { "@id": string; "@href": string; "@media-type": string; "@properties"?: string }[] = pkg.manifest?.item ?? [];

  const title = clean(text(meta.title));
  const author = (meta.creator ?? []).map((c: unknown) => clean(text(c))).filter(Boolean).join(" & ");

  // Cover: EPUB 3 "cover-image" property, else EPUB 2 <meta name="cover">.
  const coverId = (meta.meta ?? []).find((m: Record<string, string>) => m["@name"] === "cover")?.["@content"];
  const coverItem =
    items.find((i) => i["@properties"]?.split(/\s+/).includes("cover-image")) ?? items.find((i) => i["@id"] === coverId);
  let cover: BookInfo["cover"] = null;
  if (coverItem && /^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(coverItem["@media-type"])) {
    const data = files[resolve(opfPath, coverItem["@href"])];
    if (data) {
      const contentType = coverItem["@media-type"];
      cover = { data, contentType, ext: contentType === "image/svg+xml" ? "svg" : contentType.split("/")[1].replace("jpeg", "jpg") };
    }
  }

  // Table of contents: EPUB 3 nav document, else EPUB 2 NCX.
  let toc: TocEntry[] = [];
  const nav = items.find((i) => i["@properties"]?.split(/\s+/).includes("nav"));
  if (nav && files[resolve(opfPath, nav["@href"])]) {
    toc = parseNav(strFromU8(files[resolve(opfPath, nav["@href"])]), resolve(opfPath, nav["@href"]));
  } else {
    const ncx = items.find((i) => i["@media-type"] === "application/x-dtbncx+xml");
    if (ncx && files[resolve(opfPath, ncx["@href"])]) {
      toc = parseNcx(strFromU8(files[resolve(opfPath, ncx["@href"])]), resolve(opfPath, ncx["@href"]));
    }
  }

  return {
    type: "epub",
    title,
    author,
    language: clean(text(meta.language)) || null,
    publisher: clean(text(meta.publisher)) || null,
    description: clean(text(meta.description).replace(/<[^>]+>/g, " ")) || null,
    pageCount: null,
    cover,
    toc,
  };
}

// Contents are read with a DOM parser: the label must keep its words in order
// even when part of it is marked up (e.g. "Search for <abbr>Mr.</abbr> Hyde").
type Node_ = { localName?: string; tagName: string; children: ArrayLike<Node_>; textContent: string | null; getAttribute(n: string): string | null };
const local = (n: Node_) => (n.localName ?? n.tagName).toLowerCase().replace(/^.*:/, "");
const kids = (n: Node_, name: string) => Array.from(n.children).filter((c) => local(c) === name);
const descendants = (n: Node_, name: string): Node_[] =>
  Array.from(n.children).flatMap((c) => (local(c) === name ? [c] : []).concat(descendants(c, name)));

function parseNav(source: string, navPath: string): TocEntry[] {
  const root = new DOMParser().parseFromString(source, "text/xml").documentElement as unknown as Node_;
  if (!root) return [];
  const navs = descendants(root, "nav");
  const tocNav = navs.find((n) => (n.getAttribute("epub:type") ?? n.getAttribute("type") ?? "").includes("toc")) ?? navs[0];
  const walk = (ol: Node_ | undefined): TocEntry[] =>
    (ol ? kids(ol, "li") : []).map((li) => {
      const a = kids(li, "a")[0] ?? kids(li, "span")[0];
      const href = a && local(a) === "a" ? a.getAttribute("href") ?? "" : "";
      return { label: clean(a?.textContent ?? ""), href: href ? resolve(navPath, href) + hash(href) : "", children: walk(kids(li, "ol")[0]) };
    });
  return tocNav ? walk(kids(tocNav, "ol")[0]) : [];
}

function parseNcx(source: string, ncxPath: string): TocEntry[] {
  const root = new DOMParser().parseFromString(source, "text/xml").documentElement as unknown as Node_;
  const navMap = root ? descendants(root, "navMap")[0] ?? descendants(root, "navmap")[0] : undefined;
  const walk = (parent: Node_ | undefined): TocEntry[] =>
    (parent ? kids(parent, "navpoint") : []).map((p) => {
      const src = kids(p, "content")[0]?.getAttribute("src") ?? "";
      return { label: clean(kids(p, "navlabel")[0]?.textContent ?? ""), href: resolve(ncxPath, src) + hash(src), children: walk(p) };
    });
  return walk(navMap);
}

const hash = (href: string) => (href.includes("#") ? href.slice(href.indexOf("#")) : "");

export async function parsePdf(bytes: Uint8Array, fileName: string): Promise<BookInfo> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (e instanceof Error && /encrypt/i.test(e.message)) {
      throw new ImportError("This PDF is encrypted (DRM). Only DRM-free books can be added.");
    }
    throw new ImportError("This file is not a readable PDF.");
  }
  const fromName = fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  return {
    type: "pdf",
    title: clean(doc.getTitle() ?? "") || fromName,
    author: clean(doc.getAuthor() ?? ""),
    language: null,
    publisher: null,
    description: clean(doc.getSubject() ?? "") || null,
    pageCount: doc.getPageCount(),
    cover: null,
    toc: [],
  };
}

export async function readBook(bytes: Uint8Array, fileName: string): Promise<BookInfo> {
  if (bytes.byteLength > MAX_BOOK_BYTES) throw new ImportError("This file is larger than 200 MB.");
  const type = detectType(bytes);
  if (type === "pdf") return parsePdf(bytes, fileName);
  if (type === "epub") {
    const info = parseEpub(bytes);
    if (!info.title) info.title = fileName.replace(/\.epub$/i, "").replace(/[_-]+/g, " ").trim();
    return info;
  }
  throw new ImportError("Only EPUB and PDF files can be added.");
}
