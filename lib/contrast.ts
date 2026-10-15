/** WCAG 2 contrast helpers, used to check the colour tokens. */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Alpha from #rgb, #rgba, #rrggbb, or #rrggbbaa. A missing alpha is opaque. */
function hexAlpha(hex: string): { rgb: [number, number, number]; a: number } {
  const h = hex.replace("#", "");
  const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  const a = full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a };
}

/** Paint a translucent colour over an opaque one. The result is #rrggbb, as the screen shows it. */
export function blendOver(fg: string, bg: string): string {
  const front = hexAlpha(fg);
  const back = hexAlpha(bg);
  const channel = (f: number, b: number) => Math.round(f * front.a + b * (1 - front.a));
  const byte = (n: number) => n.toString(16).padStart(2, "0");
  const [r, g, b] = front.rgb;
  const [br, bgc, bb] = back.rgb;
  return `#${byte(channel(r, br))}${byte(channel(g, bgc))}${byte(channel(b, bb))}`;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Read `--name: #hex;` pairs from a block of CSS. */
export function parseColorTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{3,8})\s*;/gi)) out[m[1]] = m[2].toLowerCase();
  return out;
}
