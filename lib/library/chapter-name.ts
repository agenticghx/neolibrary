/** A chapter as a reader would say it (M28 S3): "chapter I" for a bare numeral ("I", "8."), else the book's own name. */
export function chapterName(label: string) {
  const l = label.trim();
  if (!l) return "this part";
  return /^(?:[IVXLCDM]+|\d+)\.?$/.test(l) ? `chapter ${l.replace(/\.$/, "")}` : l;
}
