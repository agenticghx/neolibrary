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
