// foliate-js ships plain ES modules without type declarations.
declare module "foliate-js/view.js";
declare module "foliate-js/epubcfi.js" {
  export function parse(cfi: string): unknown[] & { shift(): unknown };
  export function toElement(doc: Document, parts: unknown): Node;
  export function compare(a: string, b: string): number;
  export function collapse(cfi: string, toEnd?: boolean): string;
}
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
declare module "foliate-js/overlayer.js";
