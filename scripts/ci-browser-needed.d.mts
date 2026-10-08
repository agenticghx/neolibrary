/** Types for the plain script CI runs. The implementation is ci-browser-needed.mjs. */

export const BROWSER_SLICES: readonly ["screenshots", "behavior", "readalong", "narration", "webkit"];

export type BrowserSlice = (typeof BROWSER_SLICES)[number];

export function browserJobNeeded(files: readonly string[]): boolean;

/** Slice names in `BROWSER_SLICES` order. An empty array means run no browser project. */
export function browserSlices(files: readonly string[]): BrowserSlice[];

/**
 * Unset or blank, or a token this script does not know: `null` (every project).
 * `"none"`: an empty list.
 */
export function parseBrowserSlices(value: string | undefined | null): BrowserSlice[] | null;

export function sliceForProject(name: string): "setup" | BrowserSlice | null;

export function applyBrowserSlices<T extends { name?: string; dependencies?: string[] }>(
  projects: readonly T[],
  slices: readonly string[] | null,
): T[];

/** Page names the 2×2 screenshot grid requires for this slice list. */
export function gridPageNames(pageSource: string, slices: readonly string[] | string): string[];
