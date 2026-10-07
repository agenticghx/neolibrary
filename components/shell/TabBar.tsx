import { Icon, type IconName } from "./icons";
import { NavLink } from "./NavLink";
import styles from "./Shell.module.css";

const TABS: { label: string; href: string; icon: IconName }[] = [
  { label: "Home", href: "/", icon: "home" },
  { label: "Library", href: "/library", icon: "library" },
  { label: "Paths", href: "/paths", icon: "path" },
  { label: "Search", href: "/search", icon: "search" },
  // M14 follow-up V3b (Samuel, #90): the Import page, where books and audiobooks are added.
  { label: "Import", href: "/import", icon: "import" },
];

/** Phone navigation (M14, D9; Import added in follow-up V3b): five tabs at the bottom of the screen. */
export function TabBar() {
  return (
    <nav aria-label="Tabs" className={styles.tabs} data-testid="tab-bar">
      {TABS.map((t) => (
        <NavLink key={t.href} href={t.href} match="section" className={styles.tab}>
          <Icon name={t.icon} className={styles.tabIcon} />
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
