// Runs once when the server starts: applies database migrations and, if no
// account exists yet, prints the one-time setup code for the first admin.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("./lib/db");
  const { userCount } = await import("./lib/auth/service");
  const { setupCode } = await import("./lib/auth/setup-code");
  const db = await getDb();
  if ((await userCount(db)) === 0) {
    console.log(`\n  Neolibrary setup: open /setup and enter this code to create the owner account: ${setupCode()}\n`);
  }
  // Books uploaded before the section model existed get their sections now.
  const { backfillSections } = await import("./lib/library/sections-store");
  const { getStorage } = await import("./lib/storage");
  const built = await backfillSections(db, await getStorage()).catch((e) => {
    console.error("Section backfill failed", e);
    return 0;
  });
  if (built) console.log(`  Built sections for ${built} book(s).`);
  // M41 R1c: label equations and table cells in books already in the library, once (not awaited: until it reaches a
  // book, its paragraphs stay prose, as before).
  const { backfillSectionForms } = await import("./lib/library/section-forms");
  void backfillSectionForms(db, await getStorage())
    .then((r) => r && console.log(`  Section forms: ${r.labelled} paragraph(s) labelled in ${r.books} book(s).`))
    .catch((e) => console.error("Section forms backfill failed", e));
  // M22: covers for titles without one, looked up in the background (COVER_LOOKUP=off switches it off).
  const { scheduleCoverLookups } = await import("./lib/library/cover-job");
  scheduleCoverLookups(getDb, getStorage);
  // M25: text editions of scanned books; batches sent before a restart are picked up again.
  const { scheduleTextEditionPolls } = await import("./lib/library/text-edition");
  scheduleTextEditionPolls(getDb, getStorage);
  // M25: scanned books are read from page pictures; say whether this server can draw them.
  const { pagePicturesProblem } = await import("./lib/library/page-pictures");
  void pagePicturesProblem().then((problem) =>
    problem ? console.error(`  Page pictures: cannot draw them here (${problem}).`) : console.log("  Page pictures: ready."),
  );
}
