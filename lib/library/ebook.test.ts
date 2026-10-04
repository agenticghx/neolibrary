import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { detectType, ImportError, readBook } from "./ebook";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url)));

describe("reading EPUBs", () => {
  it.each([
    ["stevenson-jekyll-and-hyde.epub", "The Strange Case of Dr. Jekyll and Mr. Hyde", "Robert Louis Stevenson"],
    ["shelley-frankenstein.epub", "Frankenstein", "Mary Shelley"],
    ["wells-the-time-machine.epub", "The Time Machine", "H. G. Wells"],
  ])("%s → title, author, cover, contents", (file, title, author) => {
    return readBook(fixture(file), file).then((info) => {
      expect(info).toMatchObject({ type: "epub", title, author, language: "en-GB" });
      expect(info.cover?.contentType).toBe("image/svg+xml");
      expect(info.cover!.data.byteLength).toBeGreaterThan(1000);
      expect(info.toc.length).toBeGreaterThan(3);
      expect(info.toc[0].label).not.toBe("");
      expect(info.toc.every((t) => t.href.startsWith("epub/"))).toBe(true);
    });
  });

  it("refuses DRM-protected EPUBs but accepts font obfuscation", async () => {
    const base = {
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>',
      ),
      "c.opf": strToU8('<package><metadata><title>Locked</title></metadata><manifest/></package>'),
    };
    const enc = (alg: string) =>
      strToU8(`<encryption><EncryptedData><EncryptionMethod Algorithm="${alg}"/></EncryptedData></encryption>`);
    await expect(readBook(zipSync({ ...base, "META-INF/rights.xml": strToU8("<rights/>") }), "a.epub")).rejects.toThrow("DRM");
    await expect(
      readBook(zipSync({ ...base, "META-INF/encryption.xml": enc("http://www.w3.org/2001/04/xmlenc#aes128-cbc") }), "a.epub"),
    ).rejects.toThrow(ImportError);
    const ok = await readBook(zipSync({ ...base, "META-INF/encryption.xml": enc("http://www.idpf.org/2008/embedding") }), "a.epub");
    expect(ok.title).toBe("Locked");
  });
});

describe("reading PDFs", () => {
  it("reads title, author and page count from a text PDF", async () => {
    const info = await readBook(fixture("descartes-meditation-one.pdf"), "descartes-meditation-one.pdf");
    expect(info).toMatchObject({ type: "pdf", title: "Meditations on First Philosophy", author: "René Descartes" });
    expect(info.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the file name when the PDF has no title", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const info = await readBook(await doc.save(), "the_time-machine.pdf");
    expect(info.title).toBe("the time machine");
  });
});

describe("file types", () => {
  it("accepts only EPUB and PDF", async () => {
    expect(detectType(strToU8("%PDF-1.7"))).toBe("pdf");
    expect(detectType(strToU8("hello"))).toBeNull();
    await expect(readBook(strToU8("plain text"), "x.txt")).rejects.toThrow("Only EPUB and PDF");
  });
});
