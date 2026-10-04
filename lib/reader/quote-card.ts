/**
 * Draws a shareable image card for a quote: the passage in the book face, the
 * title and author below, a thin accent rule, and the Neolibrary wordmark.
 * Colours and fonts come from the design tokens on `el` (so the card matches
 * the reader's theme). Returns a PNG blob.
 */
export async function quoteCard(
  el: Element,
  quote: string,
  title: string,
  author: string,
  size = { width: 1200, height: 630 },
): Promise<Blob> {
  const cs = getComputedStyle(el);
  const token = (n: string) => cs.getPropertyValue(n).trim();
  const serif = '"Source Serif 4 Variable", Georgia, serif';
  const sans = '"Source Sans 3 Variable", Arial, sans-serif';
  await document.fonts.load(`48px ${serif}`).catch(() => {});
  await document.fonts.load(`26px ${sans}`).catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d")!;
  const pad = 96;
  ctx.fillStyle = token("--paper");
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.fillStyle = token("--accent");
  ctx.fillRect(pad, pad - 24, 72, 6);

  // Quote: shrink the type until it fits in the space above the credit line.
  const maxWidth = size.width - pad * 2;
  const room = size.height - pad * 2 - 90;
  let fontSize = 54;
  let lines: string[] = [];
  const text = `“${quote.trim()}”`;
  for (; fontSize >= 24; fontSize -= 2) {
    ctx.font = `${fontSize}px ${serif}`;
    lines = wrap(ctx, text, maxWidth);
    if (lines.length * fontSize * 1.32 <= room) break;
  }
  const maxLines = Math.floor(room / (fontSize * 1.32));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, "")} …”`;
  }
  ctx.fillStyle = token("--ink-900");
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, pad, pad + i * fontSize * 1.32));

  ctx.font = `600 26px ${sans}`;
  ctx.fillStyle = token("--ink-700");
  const credit = author ? `${title} — ${author}` : title;
  ctx.fillText(fit(ctx, credit, maxWidth - 220), pad, size.height - pad - 10);
  ctx.font = `26px ${serif}`;
  ctx.fillStyle = token("--ink-500");
  ctx.textAlign = "right";
  ctx.fillText("Neolibrary", size.width - pad, size.height - pad - 10);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
