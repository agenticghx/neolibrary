import { bigint, boolean, doublePrecision, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

// Mirrors db/migrations. The SQL files are the source of truth for the layout;
// this file gives TypeScript the same shape for queries.

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "reader"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  aiStyle: text("ai_style", { enum: ["plain", "ste-light", "ste-standard", "ste-strict"] }).notNull().default("ste-light"),
  /** The view a book opens in (M17, migration 0023): the book alone, the rewrite beside it, or the rewrite alone. */
  rewrittenView: text("rewritten_view", { enum: ["original", "side", "rewritten"] }).notNull().default("side"),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** 90 days after created_at. An expired token is treated as revoked. */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  note: text("note").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const appSecrets = pgTable("app_secrets", {
  name: text("name").primaryKey(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Library-wide settings the owner changes on screen (M35, migration 0034), e.g. "ai-models". */
export const appSettings = pgTable("app_settings", {
  name: text("name").primaryKey(),
  value: jsonb("value").$type<Record<string, string>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export type User = typeof users.$inferSelect;
export type Role = User["role"];

export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  author: text("author").notNull().default(""),
  note: text("note").notNull().default(""),
  unverified: boolean("unverified").notNull().default(false),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  fileType: text("file_type", { enum: ["epub", "pdf"] }),
  fileSize: integer("file_size"),
  coverKey: text("cover_key"),
  /** Where the cover came from (M22): its book file, a catalogue found by title and author, or the reader's own picture (C3b). */
  coverSource: text("cover_source", { enum: ["file", "openlibrary", "googlebooks", "fake", "upload"] }),
  /** For a found cover: the address its picture was downloaded from (which picture it is). */
  coverRef: text("cover_ref"),
  /** For a found cover: the catalogue's page for the record it came from (credit). */
  coverPage: text("cover_page"),
  /** When the catalogues were last asked for this title's cover, found or not. */
  coverCheckedAt: timestamp("cover_checked_at", { withTimezone: true }),
  /** Pictures the reader turned down, by cover_ref; never offered again. */
  coverRejected: jsonb("cover_rejected").$type<string[]>().notNull().default([]),
  isbn: text("isbn"),
  language: text("language"),
  publisher: text("publisher"),
  description: text("description"),
  toc: jsonb("toc").$type<{ label: string; href: string; children: unknown[] }[]>().notNull().default([]),
  pageCount: integer("page_count"),
  progress: real("progress").notNull().default(0),
  position: text("position"),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  /** The reader removed it themselves (not hidden for them by the library): only they bring it back (migration 0041). */
  removedByReader: boolean("removed_by_reader").notNull().default(false),
  aiStyle: text("ai_style", { enum: ["plain", "ste-light", "ste-standard", "ste-strict"] }),
  /** M25: set on a text edition (an EPUB made from a scanned PDF's pages): the scan it was made from. Hidden from the library's lists (migration 0027). */
  editionOf: uuid("edition_of").references((): AnyPgColumn => books.id, { onDelete: "cascade" }),
  /** M34 (migration 0036): the owner's book is on the open shelf: anyone may see its title, cover, author and description. */
  onShelf: boolean("on_shelf").notNull().default(true),
  /** M34: anyone may read it. Only ever on for a public-domain edition (lib/library/open-shelf.ts). */
  freeToRead: boolean("free_to_read").notNull().default(false),
  /** M41 R3: a research paper, marked by its DOI or PubMed ID, or a book (everything else) (0037; M34 took 0036). */
  kind: text("kind", { enum: ["book", "paper"] }).notNull().default("book"),
  /** A paper's authors in order, as Crossref or PubMed give them. */
  authors: jsonb("authors").$type<PaperAuthor[]>().notNull().default([]),
  journal: text("journal"),
  year: integer("year"),
  /** The paper's DOI (lower case, without "https://doi.org/"). */
  doi: text("doi"),
  /** Its PubMed ID (digits). */
  pmid: text("pmid"),
  /** M41 R3c (0038): on an invited reader's row, the owner's paper it is a shared copy of. */
  sharedFrom: uuid("shared_from").references((): AnyPgColumn => books.id, { onDelete: "set null" }),
  /** On the owner's paper: shared with invited readers (the default) or not. */
  sharePapers: boolean("share_papers").notNull().default(true),
});

/** One of a paper's authors: family name (always) and given names or initials (may be ""). */
export type PaperAuthor = { family: string; given: string };

export const paths = pgTable("paths", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  sourceUrl: text("source_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pillars = pgTable("pillars", {
  id: uuid("id").primaryKey().defaultRandom(),
  pathId: uuid("path_id")
    .notNull()
    .references(() => paths.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  question: text("question").notNull().default(""),
  group: text("grp").notNull().default("main"),
});

export const slots = pgTable("slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  pillarId: uuid("pillar_id")
    .notNull()
    .references(() => pillars.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  kind: text("kind", { enum: ["N", "E", "extra", "master"] }).notNull(),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  note: text("note").notNull().default(""),
});

export type Book = typeof books.$inferSelect;

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const collectionBooks = pgTable(
  "collection_books",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.bookId] })],
);

export const sections = pgTable(
  "sections",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    kind: text("kind", { enum: ["chapter", "section", "paragraph"] }).notNull(),
    parentId: text("parent_id"),
    position: integer("position").notNull(),
    chapterIndex: integer("chapter_index").notNull(),
    href: text("href").notNull(),
    cfi: text("cfi").notNull(),
    label: text("label").notNull().default(""),
    text: text("text").notNull().default(""),
    /** M41 R1c: a paragraph's form; only prose is rewritten or asked about (0035). */
    form: text("form", { enum: ["prose", "equation", "cell"] }).notNull().default("prose"),
    // `search` (tsvector) is generated by the database; not written from here.
  },
  (t) => [primaryKey({ columns: [t.bookId, t.id] })],
);

export const annotations = pgTable("annotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  annotationId: uuid("annotation_id").notNull(),
  version: integer("version").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["highlight", "bookmark", "note", "voice", "sticker", "drawing", "image"] }).notNull(),
  targetType: text("target_type", { enum: ["passage", "book", "pillar", "path"] }).notNull(),
  bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }),
  targetId: uuid("target_id"),
  sectionId: text("section_id"),
  cfi: text("cfi"),
  quoteExact: text("quote_exact").notNull().default(""),
  quotePrefix: text("quote_prefix").notNull().default(""),
  quoteSuffix: text("quote_suffix").notNull().default(""),
  color: text("color"),
  body: text("body").notNull().default(""),
  deleted: boolean("deleted").notNull().default(false),
  audioKey: text("audio_key"),
  audioMime: text("audio_mime"),
  durationMs: integer("duration_ms"),
  transcript: text("transcript").notNull().default(""),
  sticker: text("sticker"),
  strokes: jsonb("strokes").$type<{ width: number; height: number; strokes: number[][] }>(),
  picture: jsonb("picture").$type<Record<string, unknown>>(),
  /** The API token (by name) that added it through the agent API, or null if the reader wrote it (M11). */
  agent: text("agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const generations = pgTable("generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }),
  sectionId: text("section_id"),
  kind: text("kind").notNull(),
  options: jsonb("options").$type<Record<string, string>>().notNull().default({}),
  cacheKey: text("cache_key").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptName: text("prompt_name").notNull(),
  promptHash: text("prompt_hash").notNull(),
  inputHash: text("input_hash").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  output: text("output").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Brought back from a library file: its cost is history, not this month's spending (migration 0021). */
  imported: boolean("imported").notNull().default(false),
});

export const questionMarks = pgTable("question_marks", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  chapterId: text("chapter_id").notNull(),
  generationId: uuid("generation_id")
    .notNull()
    .references(() => generations.id, { onDelete: "cascade" }),
  questionIndex: integer("question_index").notNull(),
  correct: boolean("correct").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const audioTracks = pgTable("audio_tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  sectionId: text("section_id").notNull(),
  source: text("source", { enum: ["tts", "upload"] }).notNull(),
  provider: text("provider"),
  model: text("model"),
  voice: text("voice").notNull(),
  cacheKey: text("cache_key").notNull(),
  inputHash: text("input_hash").notNull(),
  characters: integer("characters").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  audioKey: text("audio_key").notNull(),
  mime: text("mime").notNull(),
  durationMs: integer("duration_ms").notNull(),
  words: jsonb("words").$type<[number, number, number, number][]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** M13: an uploaded track plays this stretch of a longer file; its word times are then in that file. */
  audioStartMs: integer("audio_start_ms"),
  audioEndMs: integer("audio_end_ms"),
  importId: uuid("import_id").references(() => readalongImports.id, { onDelete: "cascade" }),
  /** Brought back from a library file: its cost is history, not this month's spending (migration 0021). */
  imported: boolean("imported").notNull().default(false),
});

/** M13: one uploaded read-along package (see db/migrations/0020_readalong_imports.up.sql). */
export const readalongImports = pgTable("readalong_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["uploading", "ready"] }).notNull(),
  title: text("title"),
  voice: text("voice"),
  madeWith: text("made_with"),
  manifest: jsonb("manifest").$type<unknown>().notNull(),
  report: jsonb("report").$type<ReadalongReport>().notNull(),
  audio: jsonb("audio").$type<ReadalongAudio[]>().notNull(),
  pending: jsonb("pending").$type<ReadalongPending[] | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** Bytes of audio this import has taken in (migration 0040); a reader's imports together have a ceiling. */
  bytesReceived: bigint("bytes_received", { mode: "number" }).notNull().default(0),
});

/**
 * A paid AI call that was billed but gave nothing usable (declined, cut off, empty): counted against the spending
 * cap like a stored answer, and kept apart from `generations` so it can never be served as one (migration 0040).
 */
export const failedSpend = pgTable("failed_spend", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  kind: text("kind").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReadalongReport = { chapters: { n: number; title: string; spokenWords: number; matchedWords: number }[]; paragraphs: number };
export type ReadalongAudio = { file: string; key: string; sha256: string; seconds: number; mime: string; uploadId: string | null };
export type ReadalongPending = { sectionId: string; audio: string; startMs: number; endMs: number; words: [number, number, number, number][] };

export const readingSessions = pgTable("reading_sessions", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  activeSeconds: integer("active_seconds").notNull().default(0),
  words: integer("words").notNull().default(0),
  pages: integer("pages").notNull().default(0),
  chapters: jsonb("chapters").$type<ChapterReading[]>().notNull().default([]),
  /** M26 R3: the focus session this sitting was part of, its question, and the note holding the answer. */
  focusId: uuid("focus_id"),
  question: text("question").notNull().default(""),
  answerAnnotationId: uuid("answer_annotation_id"),
});

/**
 * M26 R4a: a focus session, kept on the server so every page on every device knows it is running (see
 * db/migrations/0029_focus_sessions_live.up.sql). The database allows one row per reader with ended_at empty.
 */
export const focusSessions = pgTable("focus_sessions", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"sitting" | "book">().notNull().default("sitting"),
  question: text("question").notNull(),
  minutes: integer("minutes").notNull(),
  /** The note that will hold the answer, chosen at the start, so a retried save makes one note. */
  noteId: uuid("note_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  /** R4b: when a wait to leave early ends. */
  waitEndsAt: timestamp("wait_ends_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endedHow: text("ended_how").$type<"time" | "answered" | "early" | "waited" | "released" | "finished">(),
});

/**
 * M32 X1: the X-ray index of a book (see db/migrations/0031_xray.up.sql). An entry is a person, place,
 * organisation or term the book names, with every way the book writes it; its kind is "name" until Claude
 * classifies it (X3). generation_id is the AI answer it came from, null when found in the text alone.
 */
export const xrayEntries = pgTable(
  "xray_entries",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<XrayKind>().notNull().default("name"),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    generationId: uuid("generation_id").references(() => generations.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.id] })],
);
export type XrayKind = "name" | "person" | "place" | "organisation" | "term" | "work" | "event";

/**
 * One occurrence of an entry's alias in one paragraph: character offsets into sections.text (whitespace
 * collapsed), the paragraph's chapter and its place in the book. Derived from the entries and the text (M32 X1).
 */
export const xrayMentions = pgTable(
  "xray_mentions",
  {
    bookId: uuid("book_id").notNull(),
    entryId: text("entry_id").notNull(),
    sectionId: text("section_id").notNull(),
    chapterIndex: integer("chapter_index").notNull(),
    position: integer("position").notNull(),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.entryId, t.sectionId, t.startAt] })],
);

/**
 * M32 X3: what the book says about an X-ray entry, one short statement per fact with the quote it rests on, by
 * chapter (see db/migrations/0032_xray_facts.up.sql). generation_id is the AI answer it came from.
 */
export const xrayFacts = pgTable("xray_facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull(),
  entryId: text("entry_id").notNull(),
  generationId: uuid("generation_id")
    .notNull()
    .references(() => generations.id, { onDelete: "cascade" }),
  chapterIndex: integer("chapter_index").notNull(),
  sectionId: text("section_id").notNull(),
  position: integer("position").notNull(),
  startAt: integer("start_at").notNull(),
  endAt: integer("end_at").notNull(),
  fact: text("fact").notNull(),
  quote: text("quote").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * M43 S2: a book's genealogy (db/migrations/0039_genealogy.up.sql). A link is one thing the book says between two named
 * people or organisations, its quote found in sections.text at [startAt, endAt); `ord` is its place in the book's list,
 * which life events name. Links the second reading removed are kept with `removed`. generation_id is the send.
 */
export const genealogyLinks = pgTable("genealogy_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  generationId: uuid("generation_id")
    .notNull()
    .references(() => generations.id, { onDelete: "cascade" }),
  ord: integer("ord").notNull(),
  fromName: text("from_name").notNull(),
  fromKind: text("from_kind").$type<GenealogyKind>().notNull(),
  toName: text("to_name").notNull(),
  toKind: text("to_kind").$type<GenealogyKind>().notNull(),
  relation: text("relation").notNull(),
  role: text("role"),
  removed: boolean("removed").notNull().default(false),
  verdict: text("verdict").$type<"holds" | "fix">(),
  was: text("was"),
  why: text("why"),
  sectionId: text("section_id").notNull(),
  chapterIndex: integer("chapter_index").notNull(),
  position: integer("position").notNull(),
  startAt: integer("start_at").notNull(),
  endAt: integer("end_at").notNull(),
  quote: text("quote").notNull(),
  dateYear: integer("date_year"),
  dateEndYear: integer("date_end_year"),
  dateSectionId: text("date_section_id"),
  dateStartAt: integer("date_start_at"),
  dateEndAt: integer("date_end_at"),
  dateQuote: text("date_quote"),
});
export type GenealogyKind = "person" | "organisation";

/** M43 S2: one event in one person's life, in the order it happened; general-knowledge years kept in their own columns. */
export const genealogyEvents = pgTable("genealogy_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  generationId: uuid("generation_id")
    .notNull()
    .references(() => generations.id, { onDelete: "cascade" }),
  person: text("person").notNull(),
  ord: integer("ord").notNull(),
  what: text("what").notNull(),
  withName: text("with_name").notNull(),
  role: text("role"),
  linkOrds: jsonb("link_ords").$type<number[]>().notNull().default([]),
  startYear: integer("start_year"),
  endYear: integer("end_year"),
  dateLinkOrds: jsonb("date_link_ords").$type<number[]>().notNull().default([]),
  basis: text("basis").$type<"stated" | "worked_out" | "ordered" | "unknown">().notNull(),
  orderSectionId: text("order_section_id"),
  orderStartAt: integer("order_start_at"),
  orderEndAt: integer("order_end_at"),
  orderQuote: text("order_quote"),
  why: text("why"),
  gkStartYear: integer("gk_start_year"),
  gkEndYear: integer("gk_end_year"),
  gkConfidence: text("gk_confidence").$type<"high" | "medium">(),
  gkNote: text("gk_note"),
});

/** Time and words of one sitting inside one chapter (M10 (c)). */
export type ChapterReading = { key: string; label: string; position: number; activeSeconds: number; words: number };

/**
 * M21: one reader's Daily review schedule for one card (see db/migrations/0024_review.up.sql). M28 (migration 0030):
 * a card is named by `cardId`, a highlight's or note's annotation id, or "q:<question bank id>:<question number>" for
 * a Test yourself question; `annotationId` is set only for highlights and notes.
 */
export const reviewCards = pgTable(
  "review_cards",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    annotationId: uuid("annotation_id"),
    ease: doublePrecision("ease").notNull().default(2.5),
    intervalDays: integer("interval_days").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    firstReviewedAt: timestamp("first_reviewed_at", { withTimezone: true }).notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }).notNull(),
    lastRating: text("last_rating", { enum: ["again", "hard", "good", "easy"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.cardId] })],
);

/** M25: a job reading a scanned PDF's pages with Claude through the Batch API (migration 0027). */
/** One batch sent: its number, the pages in it, the fingerprint (sha256) of each page picture sent, and whether its answers are saved. */
export type TextEditionBatch = { id: string; pages: number[]; hashes: string[]; stored: boolean };
export type TextEditionProblem = { page: number; kind: "refused" | "errored" | "canceled" | "expired"; message: string };
export type TextEditionCheck = { page: number; agreement: number | null; flagged: boolean };

export const textEditionJobs = pgTable("text_edition_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  bookId: uuid("book_id")
    .notNull()
    .references(() => books.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptHash: text("prompt_hash").notNull(),
  status: text("status", { enum: ["preparing", "waiting", "finished", "stopped", "failed"] }).notNull(),
  stopRequested: boolean("stop_requested").notNull().default(false),
  pageCount: integer("page_count").notNull(),
  estimateUsd: doublePrecision("estimate_usd").notNull(),
  batches: jsonb("batches").$type<TextEditionBatch[]>().notNull().default([]),
  blankPages: jsonb("blank_pages").$type<number[]>().notNull().default([]),
  problems: jsonb("problems").$type<TextEditionProblem[]>().notNull().default([]),
  checks: jsonb("checks").$type<TextEditionCheck[]>().notNull().default([]),
  message: text("message").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});
