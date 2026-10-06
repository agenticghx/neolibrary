import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { AddSectionForm, AddTitleForms, RenamePathForm } from "@/components/paths/PathForms";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { books } from "@/lib/db/schema";
import { availabilityLabel } from "@/lib/library/availability";
import { KIND_WORDS } from "@/lib/library/path-words";
import { getPathView } from "@/lib/library/paths";
import pathStyles from "../../page.module.css";
import { TitleList } from "./TitleList";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Edit path" };
export const dynamic = "force-dynamic";

/**
 * Edit your Path (M14 step 5, D10): its name, its sections, and the titles in
 * each, in order. A built-in reading list cannot be edited: its page is not found.
 */
export default async function EditPathPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  const db = await getDb();
  const slug = (await params).slug;
  const view = await getPathView(db, user.id, slug);
  if (!view || view.readingList) notFound();
  const library = await db
    .select({ id: books.id, title: books.title, author: books.author })
    .from(books)
    .where(and(eq(books.ownerId, user.id), isNull(books.deletedAt)))
    .orderBy(asc(sql`lower(${books.title})`));
  const empty = view.pillars.length === 0;

  const namePanel = (
    <section aria-labelledby="name-h" className={styles.panel}>
      <h2 id="name-h" className={styles.heading}>
        Name
      </h2>
      <RenamePathForm pathId={view.id} slug={slug} title={view.title} description={view.description} />
    </section>
  );
  // A new, empty Path starts with what to do next; once it has sections, adding one comes last.
  const addPanel = (
    <section
      aria-labelledby={empty ? "add-h" : undefined}
      aria-label={empty ? undefined : "Add a section"}
      className={styles.panel}
    >
      {empty ? (
        <h2 id="add-h" className={styles.heading}>
          Next: add a first section
        </h2>
      ) : null}
      <AddSectionForm pathId={view.id} slug={slug} />
    </section>
  );
  const sectionPanels = view.pillars.map((p) => (
    <section key={p.id} aria-labelledby={`s-${p.id}`} className={styles.panel} data-testid="edit-section">
      {/* Focusable from script only: where focus goes when a section's last title is removed. */}
      <h2 id={`s-${p.id}`} className={styles.heading} tabIndex={-1}>
        {p.title}
      </h2>
      <TitleList
        slug={slug}
        headingId={`s-${p.id}`}
        titles={p.slots.map((s) => ({
          id: s.id,
          kind: KIND_WORDS[s.kind],
          title: s.book.title,
          author: s.book.author,
          availability: availabilityLabel(s.book.available),
        }))}
      />
      <AddTitleForms pillarId={p.id} sectionTitle={p.title} slug={slug} library={library} />
    </section>
  ));

  return (
    <main className={pathStyles.main}>
      <p className={pathStyles.eyebrow}>Edit path</p>
      <h1 className={pathStyles.title}>{view.title}</h1>
      <p>
        <Link href={`/paths/${slug}`} className={styles.back}>
          See the path
        </Link>
      </p>
      {/* Fixed places, no keys: the add-section form never moves, so focus in New section and its message survive the
          first section (moving a node takes focus away); the Name form is remade once, when it moves to the top. */}
      {empty ? null : namePanel}
      {sectionPanels}
      {addPanel}
      {empty ? namePanel : null}
    </main>
  );
}
