import { CataloguePapers } from "./catalogues";
import { FakePapers } from "./fake";
import type { PaperLookup } from "./model";

export * from "./model";

/** Crossref and PubMed, or the fake in tests (AI_FAKE=1 in the browser tests, or under Vitest, or PAPER_LOOKUP=fake). */
export function getPaperLookup(env: Record<string, string | undefined> = process.env): PaperLookup {
  return env.AI_FAKE === "1" || env.VITEST || env.PAPER_LOOKUP === "fake" ? new FakePapers() : new CataloguePapers();
}
