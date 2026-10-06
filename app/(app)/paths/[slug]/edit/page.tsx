import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { moveTitleAction, removeTitleAction } from "@/app/(app)/actions";
import { AddSectionForm, AddTitleForms, RenamePathForm } from "@/components/paths/PathForms";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { books, paths } from "@/lib/db/schema";
import { availabilityLabel } from "@/lib/library/availability";
import { getPathView } from "@/lib/library/paths";
import pathStyles from "../../page.module.css";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Edit path" };
export const dynamic = "force-dynamic";

const KIND = { N: "Story first", E: "Go deeper", extra: "Plain", master: "Read last" } as const;

/** Edit your Path (M14 step 5, D10): its name, its sections, and the titles in each, in order. */
export default async function EditPathPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  const db = await getDb();
  const slug = (await params).slug;
  const view = await getPathView(db, user.id, slug);
  if (!view) notFound();
  const [path] = await db
    .select({ description: paths.description })
    .from(paths)
    .where(and(eq(paths.id, view.id), eq(paths.ownerId, user.id)));
  const library = await db
    .select({ id: books.id, title: books.title })
    .from(books)
    .where(and(eq(books.ownerId, user.id), isNull(books.deletedAt)))
    .orderBy(asc(sql`lower(${books.title})`));

  return (
    <main className={pathStyles.main}>
      <p className={pathStyles.eyebrow}>Edit path</p>
      <h1 className={pathStyles.title}>{view.title}</h1>
      <p>
        <Link href={`/paths/${slug}`} className={styles.back}>
          See the path
        </Link>
      </p>

      <section aria-labelledby="name-h" className={styles.panel}>
        <h2 id="name-h" className={styles.heading}>
          Name
        </h2>
        <RenamePathForm pathId={view.id} slug={slug} title={view.title} description={path?.description ?? ""} />
      </section>

      {view.pillars.map((p) => (
        <section key={p.id} aria-labelledby={`s-${p.id}`} className={styles.panel} data-testid="edit-section">
          <h2 id={`s-${p.id}`} className={styles.heading}>
            {p.title}
          </h2>
          {p.slots.length ? (
            <ol className={styles.titles}>
              {p.slots.map((s, i) => (
                <li key={s.id} className={styles.title}>
                  <span className={styles.titleText}>
                    <span className={styles.kind}>{KIND[s.kind]}</span>
                    <span className={styles.name}>{s.book.title}</span>
                    {s.book.author ? <span className={styles.author}>{s.book.author}</span> : null}
                    <span className={styles.available}>{availabilityLabel(s.book.available)}</span>
                  </span>
                  <span className={styles.actions}>
                    {(["up", "down"] as const).map((direction) => (
                      <form key={direction} action={moveTitleAction}>
                        <input type="hidden" name="slotId" value={s.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="direction" value={direction} />
                        <button type="submit" className={styles.button} disabled={direction === "up" ? i === 0 : i === p.slots.length - 1}>
                          {direction === "up" ? "Move up" : "Move down"}
                          <span className="visually-hidden">{` ${s.book.title}`}</span>
                        </button>
                      </form>
                    ))}
                    <form action={removeTitleAction}>
                      <input type="hidden" name="slotId" value={s.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <button type="submit" className={styles.button}>
                        Remove
                        <span className="visually-hidden">{` ${s.book.title}`}</span>
                      </button>
                    </form>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.empty}>No titles yet.</p>
          )}
          <AddTitleForms pillarId={p.id} sectionTitle={p.title} slug={slug} library={library} />
        </section>
      ))}

      <section aria-label="Add a section" className={styles.panel}>
        <AddSectionForm pathId={view.id} slug={slug} />
      </section>
    </main>
  );
}
