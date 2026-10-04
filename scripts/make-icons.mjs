// Makes the app icons for the web app manifest (192 and 512 pixels, PNG)
// from app/icon.svg, on the paper background. Run: node scripts/make-icons.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync(new URL("../app/icon.svg", import.meta.url));
for (const size of [192, 512]) {
  const inner = Math.round(size * 0.72);
  const mark = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: "#f3ede1" } })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(new URL(`../public/icons/icon-${size}.png`, import.meta.url).pathname);
  console.log(`public/icons/icon-${size}.png`);
}
