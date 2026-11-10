/**
 * Runs the cover finder (M22) on the library a DATABASE_URL points at, with the real catalogues, storing pictures
 * where FILES_DIR (or S3_BUCKET) says: for trying it on a restored copy of the live library before a deploy.
 * Prints each title with what was found. Usage (from the repository root):
 *   DATABASE_URL=postgres://… FILES_DIR=/tmp/covers npx tsx scripts/find-covers-on.ts [--force]
 *
 * It changes the database it is pointed at: opening it applies any migration (a script that changes the database
 * layout) this checkout has and the database lacks, and the covers found are written to it. So it runs only on a
 * database on this computer, unless --not-local is passed (never for the live library: that needs a backup first).
 */
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { CoverSources, GoogleBooksCovers, OpenLibraryCovers } from "@/lib/covers/sources";
import { findMissingCovers } from "@/lib/library/cover-lookup";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the library to look covers up for.");
  const host = new URL(process.env.DATABASE_URL).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && !process.argv.includes("--not-local"))
    throw new Error(`The database is on ${host}, not on this computer. This script changes it (migrations and covers). Pass --not-local if that is meant.`);
  const key = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  // The real catalogues, chosen here: getCoverSource() would hand back the fake under a test runner.
  const source = new CoverSources([new OpenLibraryCovers(), ...(key ? [new GoogleBooksCovers(key)] : [])]);
  const started = Date.now();
  const r = await findMissingCovers(await getDb(), await getStorage(), source, {
    force: process.argv.includes("--force"),
    onProgress: (p) => {
      if (p.done % 10 === 0 || p.done === p.total) console.log(`${p.done}/${p.total} looked up, ${p.found} found (${Math.round((Date.now() - started) / 1000)} s)`);
    },
  });
  console.log(JSON.stringify(r));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
