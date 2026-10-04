// foliate-js ships plain ES modules without type declarations.
declare module "foliate-js/view.js";
declare module "foliate-js/epubcfi.js" {
  export function parse(cfi: string): unknown[] & { shift(): unknown };
  export function toElement(doc: Document, parts: unknown): Node;
}
