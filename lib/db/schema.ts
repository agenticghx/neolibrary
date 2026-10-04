import { boolean, doublePrecision, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  aiStyle: text("ai_style", { enum: ["plain", "ste-light", "ste-standard", "ste-strict"] }).notNull().default("plain"),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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
});

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
});
