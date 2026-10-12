/** The catalogues' names as the pages say them ("From Open Library"); a module of its own, so the browser can use it. */
const NAMES: Record<string, string> = { openlibrary: "Open Library", googlebooks: "Google Books", fake: "the test catalogue" };

export const catalogueName = (source: string | null | undefined) => NAMES[source ?? ""] ?? "a catalogue";
