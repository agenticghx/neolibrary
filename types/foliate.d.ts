// foliate-js ships plain ES modules without type declarations.
declare module "foliate-js/view.js";
declare module "foliate-js/epubcfi.js" {
  export type Parts = unknown[] & { shift(): unknown; parent?: unknown[] & { shift(): unknown } };
  export function parse(cfi: string): Parts;
  /** M41 R5: `filter` answers 1 (count the node), 2 (leave it out) or 3 (look through it), like a NodeFilter. */
  export function fromRange(range: Range, filter?: (node: Node) => number): string;
  export function toRange(doc: Document, parts: Parts, filter?: (node: Node) => number): Range;
  export function joinIndir(...cfis: string[]): string;
  export const fake: { fromIndex(index: number): string; toIndex(part: unknown): number };
  export function toElement(doc: Document, parts: unknown): Node;
  export function compare(a: string, b: string): number;
  export function collapse(cfi: string, toEnd?: boolean): string;
}
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
declare module "foliate-js/overlayer.js";
