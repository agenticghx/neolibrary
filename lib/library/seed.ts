import { hiddenMachinery } from "@/data/paths/hidden-machinery";
import type { SeedPath } from "@/data/paths/types";

/** Paths anyone can add to their library with one click. */
export const STARTER_PATHS: Record<string, SeedPath> = { [hiddenMachinery.slug]: hiddenMachinery };
