// Makes fixtures/books/descartes-meditation-one.pdf: a short, text-based PDF
// of a public-domain text (Descartes, Meditation I, John Veitch's 1901
// translation), with title and author in its metadata.
// Run: node scripts/make-fixture-pdf.mjs
import { writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";

const paragraphs = [
  "MEDITATION I. OF THE THINGS OF WHICH WE MAY DOUBT.",
  "Several years have now elapsed since I first became aware that I had accepted, even from my youth, many false opinions for true, and that consequently what I afterward based on such principles was highly doubtful; and from that time I was convinced of the necessity of undertaking once in my life to rid myself of all the opinions I had adopted, and of commencing anew the work of building from the foundation, if I desired to establish a firm and abiding superstructure in the sciences.",
  "But as this enterprise appeared to me to be one of great magnitude, I waited until I had attained an age so mature as to leave me no hope that at any stage of life more advanced I should be better able to execute my design. On this account, I have delayed so long that I should henceforth consider I was doing wrong were I still to consume in deliberation any of the time that now remains for action.",
  "To-day, then, since I have opportunely freed my mind from all cares, and am happily disturbed by no passions, and since I am in the secure possession of leisure in a peaceable retirement, I will at length apply myself earnestly and freely to the general overthrow of all my former opinions.",
];

const doc = await PDFDocument.create();
doc.setTitle("Meditations on First Philosophy");
doc.setAuthor("René Descartes");
doc.setLanguage("en");
doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
const font = await doc.embedFont(StandardFonts.TimesRoman);
const size = 12;
const width = 612;
const margin = 72;
let page = doc.addPage([width, 792]);
let y = 792 - margin;
for (const para of paragraphs) {
  const words = para.split(" ");
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > width - 2 * margin) {
      page.drawText(line, { x: margin, y, size, font });
      y -= size * 1.5;
      line = w;
      if (y < margin) {
        page = doc.addPage([width, 792]);
        y = 792 - margin;
      }
    } else line = test;
  }
  page.drawText(line, { x: margin, y, size, font });
  y -= size * 2.5;
}
await writeFile("fixtures/books/descartes-meditation-one.pdf", await doc.save({ useObjectStreams: false }));
console.log("wrote fixtures/books/descartes-meditation-one.pdf");
