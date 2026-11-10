/** A chapter as a reader would say it (M28 S3): "chapter I" for a bare numeral ("I", "8."), else the book's own name. */
export function chapterName(label: string) {
  const l = label.trim();
  if (!l) return "this part";
  // A Roman numeral as one is written (XIV, not any run of its letters: "CIVIL" and "DIM" are words).
  return /^(?:(?=[IVXLCDM])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})|\d+)\.?$/.test(l) ? `chapter ${l.replace(/\.$/, "")}` : l;
}
