import Link from "next/link";
import { signOutAction } from "@/app/(app)/actions";
import { Mark } from "@/components/Mark";
import { Icon, type IconName } from "./icons";
import { NavLink } from "./NavLink";
import styles from "./Shell.module.css";

/** The library's filters (M14 D5; /library?show=…, lib/library/shelf.ts SHOWS). */
export const LIBRARY_LINKS: { label: string; href: string; icon: IconName }[] = [
  { label: "All", href: "/library", icon: "library" },
  { label: "Want to Read", href: "/library?show=want", icon: "want" },
  { label: "Finished", href: "/library?show=finished", icon: "finished" },
  { label: "Books", href: "/library?show=books", icon: "book" },
  { label: "Audiobooks", href: "/library?show=audiobooks", icon: "audio" },
  { label: "PDFs", href: "/library?show=pdfs", icon: "pdf" },
];

type Props = {
  user: { name: string; role: string };
  paths: { id: string; slug: string; title: string; started: number; total: number }[];
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

/** Desktop navigation (M14, "Home on desktop A"): Home, the library's filters, Paths, Collections, and the account. */
export function Sidebar({ user, paths, collections }: Props) {
  return (
    <aside className={styles.sidebar} aria-label="Sidebar">
      <Link href="/" className={styles.brand}>
        <Mark size={28} />
        <span className={styles.wordmark}>Neolibrary</span>
      </Link>
      {/* No search button: the /search page has its own button named "Search" (tests find it by that name). */}
      <form action="/search" className={styles.search} role="search" aria-label="Search your library">
        <label htmlFor="sidebar-search" className="visually-hidden">
          Search your library
        </label>
        <Icon name="search" className={styles.searchIcon} />
        <input id="sidebar-search" type="search" name="q" placeholder="Search books and notes" className={styles.searchInput} />
      </form>
      <nav aria-label="Main" className={styles.nav}>
        <ul className={styles.group}>
          <Item href="/" icon="home" label="Home" />
        </ul>
        <p className={styles.groupLabel} id="nav-library">
          Library
        </p>
        <ul className={styles.group} aria-labelledby="nav-library">
          {LIBRARY_LINKS.map((l) => (
            <Item key={l.href} href={l.href} icon={l.icon} label={l.label} />
          ))}
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
                <>
                  {p.started} of {p.total}
                  <span className="visually-hidden"> pillars</span> started
                </>
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
      <div className={styles.foot}>
        <p className={styles.who}>
          <span className={styles.initialSmall} aria-hidden="true">
            {user.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
          {user.name}
        </p>
        <p className={styles.footLinks}>
          <Link href="/stats">Reading stats</Link>
          <Link href="/data">Your data</Link>
          {user.role === "admin" ? <Link href="/admin/invites">Invite</Link> : null}
        </p>
        <form action={signOutAction}>
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
