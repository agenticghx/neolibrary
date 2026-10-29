import Form from "next/form";
import Link from "next/link";
import { Mark } from "@/components/Mark";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { partsWord } from "@/lib/library/path-words";
import { focusedBookIds } from "@/lib/library/focus-lock";
import { dueCount } from "@/lib/library/review";
import { AccountMenu } from "./AccountMenu";
import { Icon, type IconName } from "./icons";
import { NavLink } from "./NavLink";
import styles from "./Shell.module.css";

/** The library's filters (M14 D5; /library?show=…, lib/library/shelf.ts SHOWS). Books is every title; Has audio is inside it, on the page. */
export const LIBRARY_LINKS: { label: string; href: string; icon: IconName }[] = [
  { label: "Books", href: "/library", icon: "book" },
  { label: "Want to Read", href: "/library?show=want", icon: "want" },
  { label: "Finished", href: "/library?show=finished", icon: "finished" },
];

type Props = {
  user: { name: string; email: string; role: string };
  paths: { id: string; slug: string; title: string; started: number; total: number; readingList: boolean }[];
  collections: { id: string; name: string }[];
};

function Item({ href, icon, label, meta }: { href: string; icon: IconName; label: string; meta?: React.ReactNode }) {
  return (
    <li>
      <NavLink href={href} className={styles.item}>
        <Icon name={icon} className={[styles.icon, icon === "plus" ? styles.add : ""].join(" ")} />
        <span className={styles.itemText}>
          <span className={styles.itemLabel}>{label}</span>
          {meta ? <span className={styles.itemMeta}>{meta}</span> : null}
        </span>
      </NavLink>
    </li>
  );
}

/**
 * Daily review (M21), with how many cards wait today. The layout (not ours to change) does not pass the
 * count, so the item reads it itself; currentUser() is cached for the request. A failed count shows no count.
 */
async function ReviewItem() {
  const user = await currentUser();
  // During a whole-book focus (M26 R5), only that book's cards.
  const due = user ? await getDb().then(async (db) => dueCount(db, user.id, new Date(), await focusedBookIds(db, user.id))).catch(() => 0) : 0;
  return <Item href="/review" icon="review" label="Review" meta={due > 0 ? `${due} due today` : undefined} />;
}

/** Desktop navigation (M14, "Home on desktop A"): Home and Review (M21), the library's filters and Import, Paths, Collections, and the account. */
export function Sidebar({ user, paths, collections }: Props) {
  return (
    <aside id="sidebar" className={styles.sidebar} aria-label="Sidebar">
      <Link href="/" className={styles.brand}>
        <Mark size={28} />
        <span className={styles.wordmark}>Neolibrary</span>
      </Link>
      {/* No search button: the /search page has its own button named "Search" (tests find it by that name). */}
      {/* Form, not form: searching moves within the app (reading aloud goes on), not to a whole new page. */}
      <Form action="/search" className={styles.search} role="search" aria-label="Search your library">
        <label htmlFor="sidebar-search" className="visually-hidden">
          Search your library
        </label>
        <Icon name="search" className={styles.searchIcon} />
        <input id="sidebar-search" type="search" name="q" placeholder="Search books and notes" className={styles.searchInput} />
      </Form>
      <nav aria-label="Main" className={styles.nav}>
        <ul className={styles.group}>
          <Item href="/" icon="home" label="Home" />
          <ReviewItem />
        </ul>
        <p className={styles.groupLabel} id="nav-library">
          Library
        </p>
        <ul className={styles.group} aria-labelledby="nav-library">
          {LIBRARY_LINKS.map((l) => (
            <Item key={l.href} href={l.href} icon={l.icon} label={l.label} />
          ))}
          {/* Last in the list, after PDFs (M14 follow-up V3b; Samuel, #90): the one place to add books and audiobooks. */}
          <Item href="/import" icon="import" label="Import" />
        </ul>
        <p className={styles.groupLabel} id="nav-paths">
          Paths
        </p>
        <ul className={styles.group} aria-labelledby="nav-paths">
          {paths.map((p) => (
            <Item
              key={p.id}
              href={`/paths/${p.slug}`}
              icon="path"
              label={p.title}
              meta={
                p.total ? (
                  <>
                    {p.started} of {p.total}
                    <span className="visually-hidden">{` ${partsWord(p.readingList, p.total)}`}</span> started
                  </>
                ) : (
                  "No sections yet"
                )
              }
            />
          ))}
          <Item href="/paths/new" icon="plus" label="New path" />
        </ul>
        <p className={styles.groupLabel} id="nav-collections">
          Collections
        </p>
        <ul className={styles.group} aria-labelledby="nav-collections">
          {collections.map((c) => (
            <Item key={c.id} href={`/library?c=${c.id}`} icon="collection" label={c.name} />
          ))}
          <Item href="/library?new=collection" icon="plus" label="New collection" />
        </ul>
      </nav>
      {/* The account (M18, Samuel's pick "computer A"): the initial, the name and an arrow; the menu opens above them. */}
      <div className={styles.foot}>
        <AccountMenu placement="sidebar" name={user.name} email={user.email} admin={user.role === "admin"} />
      </div>
    </aside>
  );
}
