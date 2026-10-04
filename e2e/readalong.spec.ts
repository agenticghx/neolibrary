import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { zipSync } from "fflate";
import { extractSections } from "@/lib/library/sections";
import { buildPackage } from "@/lib/readalong/fixture";
import { ADMIN_STATE } from "./pages";

// M13 (c2): uploading a read-along package through the real server: the
// package without its audio, the audio in parts, then finishing. The package
// is built in code from the same Jekyll and Hyde file the uploads test added.

test.use({ storageState: ADMIN_STATE });

const BOOK = new Uint8Array(readFileSync("fixtures/books/stevenson-jekyll-and-hyde.epub"));

test("an audiobook package is uploaded in parts, checked, and becomes read-aloud tracks; it can be removed", async ({ page }) => {
  await page.goto("/shelf");
  const books = (await (await page.request.get("/api/export")).json()).books as { id: string; title: string }[];
  const bookId = books.find((b) => b.title.startsWith("The Strange Case"))!.id;
  const paragraphs = extractSections(BOOK).filter((s) => s.kind === "paragraph").slice(20, 23);
  const { files } = buildPackage({
    bookBytes: BOOK,
    chapters: [{ title: "Chapter", paragraphs: ["Chapter Three.", ...paragraphs.map((p) => p.text)], inBook: [null, ...paragraphs.map((p) => p.chapterIndex)] }],
  });
  const zip = zipSync(Object.fromEntries(Object.entries(files).filter(([n]) => !n.startsWith("audio/"))));

  // Not signed in: refused.
  const anon = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anon.request.post(new URL(`/api/books/${bookId}/readalong`, page.url()).href, { data: Buffer.from(zip) })).status()).toBe(401);
  await anon.close();

  const started = await page.request.post(`/api/books/${bookId}/readalong`, { data: Buffer.from(zip), headers: { "content-type": "application/zip" } });
  expect(started.status()).toBe(201);
  const { import: imp, partBytes } = await started.json();
  expect(imp).toMatchObject({ status: "uploading", waitingFor: ["audio/01.wav"], report: { paragraphs: 3 } });
  expect(partBytes).toBe(8 * 1024 * 1024);

  const audio = files["audio/01.wav"];
  const half = Math.floor(audio.byteLength / 2);
  const parts = [];
  for (const [n, bytes] of [audio.slice(0, half), audio.slice(half)].entries()) {
    const res = await page.request.put(`/api/books/${bookId}/readalong/${imp.id}/parts?file=${encodeURIComponent("audio/01.wav")}&part=${n + 1}`, { data: Buffer.from(bytes) });
    expect(res.status()).toBe(200);
    parts.push(await res.json());
  }
  const finished = await page.request.post(`/api/books/${bookId}/readalong/${imp.id}/finish`, { data: { parts: { "audio/01.wav": parts } } });
  expect(finished.status()).toBe(200);
  expect((await finished.json()).import).toMatchObject({ id: imp.id, status: "ready", waitingFor: [] });

  const exported = await (await page.request.get("/api/export")).json();
  const uploaded = exported.audioTracks
    .filter((t: { importId: string | null }) => t.importId === imp.id)
    .sort((a: { audioStartMs: number }, b: { audioStartMs: number }) => a.audioStartMs - b.audioStartMs);
  expect(uploaded.map((t: { sectionId: string }) => t.sectionId)).toEqual(paragraphs.map((p) => p.id));
  expect(uploaded[0]).toMatchObject({ source: "upload", mime: "audio/wav", audioStartMs: expect.any(Number), audioEndMs: expect.any(Number) });

  // A package made from a different file of the book is refused, in plain words.
  const other = buildPackage({ bookBytes: new Uint8Array([1, 2, 3]), chapters: [{ title: "x", paragraphs: [paragraphs[0].text], inBook: [paragraphs[0].chapterIndex] }] });
  const wrong = await page.request.post(`/api/books/${bookId}/readalong`, { data: Buffer.from(other.zip()) });
  expect(wrong.status()).toBe(400);
  expect((await wrong.json()).error).toMatch(/made from a different file of this book/);

  expect((await page.request.get(`/api/books/${bookId}/readalong`)).ok()).toBe(true);
  expect((await page.request.delete(`/api/books/${bookId}/readalong/${imp.id}`)).status()).toBe(204);
  const after = await (await page.request.get("/api/export")).json();
  expect(after.audioTracks.filter((t: { importId: string | null }) => t.importId === imp.id)).toEqual([]);
  expect((await (await page.request.get(`/api/books/${bookId}/readalong`)).json()).imports).toEqual([]);
});
