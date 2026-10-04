import { strToU8, zipSync } from "fflate";

/** A tiny DRM-free EPUB with the given title, for tests (public-domain text). */
export function tinyEpub(title: string, author = "Test Author"): Uint8Array {
  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>'),
    "c.opf": strToU8(
      `<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator></metadata><manifest><item id="t" href="t.xhtml" media-type="application/xhtml+xml"/></manifest></package>`,
    ),
    "t.xhtml": strToU8("<html><body><p>Call me Ishmael.</p></body></html>"),
  });
}

/** A small but complete EPUB 3 (spine, nav) with the given chapter bodies, for reader tests. */
export function readableEpub(title: string, chapters: string[], author = "Test Author"): Uint8Array {
  const items = chapters.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("");
  const nav = chapters.map((_, i) => `<li><a href="c${i}.xhtml">Chapter ${i + 1}</a></li>`).join("");
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/c.opf": strToU8(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:test</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${items}</manifest><spine>${spine}</spine></package>`,
    ),
    "OEBPS/nav.xhtml": strToU8(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${nav}</ol></nav></body></html>`,
    ),
  };
  chapters.forEach((body, i) => {
    files[`OEBPS/c${i}.xhtml`] = strToU8(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${i + 1}</title></head><body>${body}</body></html>`,
    );
  });
  return zipSync(files);
}
