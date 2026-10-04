/**
 * Rewrite levels and STE strictness (M6). Kept apart from `rewrite.ts` so the
 * reader (browser code) can use them without pulling in server code.
 */
export const LEVELS = {
  plain: "Plain English",
  biologist: "For a biologist",
  background: "Add missing background",
  shorter: "Shorter",
  ste: "STE",
} as const;
export type Level = keyof typeof LEVELS;
export const isLevel = (v: unknown): v is Level => typeof v === "string" && Object.hasOwn(LEVELS, v);

/**
 * STE (Simplified Technical English) strictness, from Samuel's STE skill:
 * Light, Standard (about 80%, the default) or Strict (full STE). A
 * percentage maps to a level: 90% or more is Strict, 70-89% Standard, below
 * 70% Light.
 */
export const STRICTNESS = { light: "Light", standard: "Standard (≈80%)", strict: "Strict (full STE)" } as const;
export type Strictness = keyof typeof STRICTNESS;

export function strictnessFrom(v: unknown): Strictness | null {
  if (typeof v === "string" && Object.hasOwn(STRICTNESS, v)) return v as Strictness;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+(\.\d+)?\s*%?\s*$/.test(v) ? parseFloat(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n >= 90 ? "strict" : n >= 70 ? "standard" : "light";
}

/** The style AI explanations are written in: plain English, or STE at a strictness. */
export const STYLES = {
  plain: "Plain English",
  "ste-light": "STE, Light",
  "ste-standard": "STE, Standard (≈80%)",
  "ste-strict": "STE, Strict (full STE)",
} as const;
export type Style = keyof typeof STYLES;
export const isStyle = (v: unknown): v is Style => typeof v === "string" && Object.hasOwn(STYLES, v);
/** The STE strictness of a style, or null for plain English. */
export const styleStrictness = (s: Style): Strictness | null => (s === "plain" ? null : (s.slice(4) as Strictness));
