import { expect, type Page } from "@playwright/test";

/**
 * "Discourse on the Method": a three-page PDF made in the test (pdf-lib), uploaded by reader.spec.ts in the chain.
 * readalong.spec.ts plays an audiobook on it; on CI's read-along machine, which does not run reader.spec.ts
 * (scripts/ci-browser-needed.mjs), it uploads the same file itself if the library does not have it yet.
 */
export const DISCOURSE_TITLE = "Discourse on the Method";

export async function discoursePdf(): Promise<Buffer> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(DISCOURSE_TITLE);
  doc.setAuthor("René Descartes");
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const lines = [
    "Good sense is, of all things among men, the most equally distributed.",
    "The diversity of our opinions does not arise from some being endowed with a larger share of reason.",
    "It is not enough to have a vigorous mind; the prime requisite is rightly to apply it.",
  ];
  lines.forEach((text, i) => {
    const p = doc.addPage([612, 792]);
    p.drawText(`Part ${i + 1}`, { x: 72, y: 700, size: 18, font });
    p.drawText(text, { x: 72, y: 660, size: 11, font });
  });
  return Buffer.from(await doc.save());
}

/** Uploads the Discourse PDF on the Import page, as a reader does. */
export async function uploadDiscourse(page: Page) {
  await page.goto("/import");
  await page.getByLabel("Choose files").setInputFiles({ name: "discourse.pdf", mimeType: "application/pdf", buffer: await discoursePdf() });
  await expect(page.getByTestId("upload-results").getByText("Added to your library")).toBeVisible();
}

/** Uploads it only if the signed-in reader's library does not have it (the whole chain's run already does). */
export async function ensureDiscourse(page: Page) {
  const books = (await (await page.request.get("/api/export")).json()).books as { title: string }[];
  if (!books.some((b) => b.title === DISCOURSE_TITLE)) await uploadDiscourse(page);
}
