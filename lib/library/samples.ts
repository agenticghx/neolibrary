import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "@/lib/db/client";
import type { Storage } from "@/lib/storage";
import { importBook } from "./import";

/**
 * Free classics a reader can add with one click, so an empty library has
 * something to read straight away. All three are Standard Ebooks editions:
 * US public domain, with Standard Ebooks' own work dedicated to the public
 * domain (CC0); see fixtures/README.md. The same files the tests use.
 */
export const SAMPLE_BOOKS = [
  { file: "shelley-frankenstein.epub", title: "Frankenstein", author: "Mary Shelley" },
  { file: "stevenson-jekyll-and-hyde.epub", title: "The Strange Case of Dr. Jekyll and Mr. Hyde", author: "Robert Louis Stevenson" },
  { file: "wells-the-time-machine.epub", title: "The Time Machine", author: "H. G. Wells" },
] as const;

const DIR = path.join(process.cwd(), "fixtures", "books");

/** Adds the sample books to a reader's shelf; ones already there are left alone. Returns how many were added. */
export async function addSampleBooks(db: Db, storage: Storage, ownerId: string, dir = DIR) {
  let added = 0;
  for (const b of SAMPLE_BOOKS) {
    const bytes = new Uint8Array(await readFile(path.join(dir, b.file)));
    const r = await importBook(db, storage, ownerId, { name: b.file, bytes });
    if (r.status !== "duplicate") added += 1;
  }
  return added;
}
