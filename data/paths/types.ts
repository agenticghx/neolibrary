/** A study Path as a seed: pillars in reading order, each with ordered slots. */
export type SlotKind = "N" | "E" | "extra" | "master";

export type SeedBook = {
  kind: SlotKind;
  title: string;
  author: string;
  /** One line on why it is here (from the list). */
  note?: string;
  /** Agent suggestion, not checked against a catalog (shown as such). */
  unverified?: boolean;
};

export type SeedPillar = {
  slug: string;
  title: string;
  question?: string;
  group: "main" | "finance" | "blindspot" | "suggested" | "master";
  books: SeedBook[];
};

export type SeedPath = {
  slug: string;
  title: string;
  description: string;
  sourceUrl: string;
  pillars: SeedPillar[];
};
