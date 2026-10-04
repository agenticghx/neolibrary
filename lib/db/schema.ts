import { boolean, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
