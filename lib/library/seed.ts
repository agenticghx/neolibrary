import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import type { SeedPath } from "@/data/paths/types";

/** Paths anyone can add to their library with one click. */
export const STARTER_PATHS: Record<string, SeedPath> = { [hiddenMachinery.slug]: hiddenMachinery };

/** The built-in reading list at this address, if any (own keys only: "constructor" is not one). */
export function starterPath(slug: string): SeedPath | undefined {
  return Object.hasOwn(STARTER_PATHS, slug) ? STARTER_PATHS[slug] : undefined;
}

/**
 * Whether a Path is a built-in reading list (Hidden Machinery): it keeps its
 * own words and cannot be edited. A Path the reader made never has such an
 * address (createPath skips them), so the address tells them apart.
 */
export const isReadingList = (slug: string) => starterPath(slug) !== undefined;
