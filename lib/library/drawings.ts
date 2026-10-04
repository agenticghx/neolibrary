/**
 * Handwritten notes (M8): pen strokes on a pad of a fixed size (600 × 300
 * units), stored as lists of whole-number points [x1, y1, x2, y2, …], so a
 * drawing redraws the same on every screen. Shared by the server and the reader.
 */
export const PAD = { width: 600, height: 300 } as const;
export const MAX_STROKES = 300;
export const MAX_POINTS = 20_000;

export type Drawing = { width: number; height: number; strokes: number[][] };

/** Checks and tidies strokes from the browser; null if they are not a drawing. */
export function cleanDrawing(input: unknown): Drawing | null {
  const d = input as { strokes?: unknown } | null;
  if (!d || !Array.isArray(d.strokes) || !d.strokes.length || d.strokes.length > MAX_STROKES) return null;
  let points = 0;
  const strokes: number[][] = [];
  for (const s of d.strokes) {
    if (!Array.isArray(s) || s.length < 2 || s.length % 2) return null;
    const pts = s.map((n, i) => Math.round(Math.min(Math.max(Number(n), 0), i % 2 ? PAD.height : PAD.width)));
    if (pts.some((n) => !Number.isFinite(n))) return null;
    points += pts.length / 2;
    if (points > MAX_POINTS) return null;
    strokes.push(pts);
  }
  return { width: PAD.width, height: PAD.height, strokes };
}

/** An SVG path for one stroke ("M x y L x y …"); a single point becomes a dot. */
export function strokePath(points: number[]) {
  if (points.length === 2) return `M${points[0]} ${points[1]}h0.01`;
  let d = `M${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) d += `L${points[i]} ${points[i + 1]}`;
  return d;
}

/** The pen badge drawn in the margin beside a handwritten note's passage (24 × 24 grid). */
export const PEN_PATHS = ["M5 19l3.5-.8L18.4 8.3a1.8 1.8 0 0 0-2.6-2.6L5.8 15.6z", "M14.6 6.9l2.5 2.5"];
