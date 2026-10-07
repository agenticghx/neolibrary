import { strFromU8, strToU8, zipSync } from "fflate";

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
  return zipSync(readableEpubFiles(title, chapters, author));
}

/**
 * Zips for the EPUB limits (EPUB_ZIP_LIMITS in ./ebook), built here rather
 * than kept as binary files: a readable one-chapter EPUB with something
 * added. This one is padded with one-byte files to `entries` files in all.
 */
export function epubWithEntries(entries: number, title = "Many Files"): Uint8Array {
  const files = readableEpubFiles(title, ["<p>One short page.</p>"]);
  const padding = entries - Object.keys(files).length;
  for (let i = 0; i < padding; i++) files[`OEBPS/extra/${i}.txt`] = strToU8("x");
  return zipSync(files);
}

/**
 * The same EPUB, but its zip's table of contents (the "central directory")
 * says its files unpack to `declared` bytes in all, as a zip bomb's does.
 * Only that claim is rewritten after zipSync: the chapter really unpacks to
 * 143 bytes.
 */
export function epubDeclaring(declared: number, title = "Big Claims"): Uint8Array {
  const zip = zipSync(readableEpubFiles(title, ["<p>One short page.</p>"])); // deflated: a stored file's two sizes must agree
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22; // zipSync adds no comment, so the end record is the last 22 bytes
  let at = view.getUint32(end + 16, true); // where the directory starts
  let others = 0;
  let chapter = -1;
  for (let i = view.getUint16(end + 10, true); i > 0; i--) {
    const nameLength = view.getUint16(at + 28, true);
    if (strFromU8(zip.subarray(at + 46, at + 46 + nameLength)) === "OEBPS/c0.xhtml") chapter = at;
    else others += view.getUint32(at + 24, true); // each file's unpacked size
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  view.setUint32(chapter + 24, declared - others, true);
  return zip;
}

function readableEpubFiles(title: string, chapters: string[], author = "Test Author"): Record<string, Uint8Array> {
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
  return files;
}
