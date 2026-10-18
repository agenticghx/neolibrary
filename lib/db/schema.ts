import { boolean, doublePrecision, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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
  aiStyle: text("ai_style", { enum: ["plain", "ste-light", "ste-standard", "ste-strict"] }),
  /** M25: set on a text edition (an EPUB made from a scanned PDF's pages): the scan it was made from. Hidden from the library's lists (migration 0027). */
  editionOf: uuid("edition_of").references((): AnyPgColumn => books.id, { onDelete: "cascade" }),
});

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

/** Time and words of one sitting inside one chapter (M10 (c)). */
export type ChapterReading = { key: string; label: string; position: number; activeSeconds: number; words: number };

/** M21: one reader's Daily review schedule for one highlight or note (see db/migrations/0024_review.up.sql). */
export const reviewCards = pgTable(
  "review_cards",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    annotationId: uuid("annotation_id").notNull(),
    ease: doublePrecision("ease").notNull().default(2.5),
    intervalDays: integer("interval_days").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    firstReviewedAt: timestamp("first_reviewed_at", { withTimezone: true }).notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }).notNull(),
    lastRating: text("last_rating", { enum: ["again", "hard", "good", "easy"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.annotationId] })],
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
