import { readFileSync } from "node:fs";
import { strToU8, unzipSync, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { detectType, ImportError, readBook, unzipEpub } from "./ebook";
import { epubDeclaring, epubWithEntries } from "./test-epub";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url)));

/** What reading a file throws, or null when it is read. */
const refusal = (bytes: Uint8Array) => readBook(bytes, "upload.epub").then(() => null, (e: unknown) => e);

describe("EPUB zip limits: a zip bomb is refused in plain words; real books read as before", () => {
  it("unpacks the three sample books exactly as fflate's unzipSync did: the same files, byte for byte", () => {
    for (const file of ["shelley-frankenstein.epub", "stevenson-jekyll-and-hyde.epub", "wells-the-time-machine.epub"]) {
      const bytes = fixture(file);
      expect(unzipEpub(bytes)).toEqual(unzipSync(bytes));
    }
  });

  it("refuses an EPUB whose zip says it unpacks to more than 512 MB", async () => {
    const e = await refusal(epubDeclaring(512 * 1024 * 1024 + 1));
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toBe("This EPUB would unpack to more than 512 MB, far more than any real book, so it was not added.");
  });

  it("refuses an EPUB of more than 10,000 files, and reads one of exactly 10,000", async () => {
    const e = await refusal(epubWithEntries(10_001));
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toBe("This EPUB holds more than 10,000 files, far more than any real book, so it was not added.");
    const atLimit = epubWithEntries(10_000);
    expect(Object.keys(unzipSync(atLimit))).toHaveLength(10_000);
    expect((await readBook(atLimit, "many.epub")).title).toBe("Many Files");
  });

  it("still calls a damaged zip not a readable EPUB", async () => {
    const e = await refusal(strToU8("PK, but not a zip"));
    expect(e).toBeInstanceOf(ImportError);
    expect((e as Error).message).toBe("This file is not a readable EPUB.");
  });
});

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

  it("keeps contents labels in reading order even with inline markup", async () => {
    const info = await readBook(fixture("stevenson-jekyll-and-hyde.epub"), "j.epub");
    const labels = info.toc.flatMap((t) => [t.label, ...t.children.map((c) => c.label)]);
    expect(labels).toContain("Search for Mr. Hyde");
    expect(labels).toContain("Dr. Lanyon’s Narrative");
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
