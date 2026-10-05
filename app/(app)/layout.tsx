import Link from "next/link";
import { Mark } from "@/components/Mark";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { Sidebar } from "@/components/shell/Sidebar";
import { TabBar } from "@/components/shell/TabBar";
import styles from "@/components/shell/Shell.module.css";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listPathsWithProgress } from "@/lib/library/paths";
import { listCollections } from "@/lib/library/shelf";

// Everything under (app) needs a signed-in user, checked against the database.
// The shell (M14): a sidebar on desktop; on a phone, a top strip with the
// account menu and four tabs at the bottom.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  const [paths, collections] = await Promise.all([listPathsWithProgress(db, user.id), listCollections(db, user.id)]);
  return (
    <div className={styles.shell}>
      <a href="#content" className={styles.skip}>
        Skip to the page
      </a>
      <Sidebar user={user} paths={paths} collections={collections} />
      <div className={styles.column}>
        <header className={styles.phoneBar}>
          <Link href="/" className={styles.brand}>
            <Mark size={26} />
            <span className={styles.wordmark}>Neolibrary</span>
          </Link>
          <AccountMenu name={user.name} admin={user.role === "admin"} />
        </header>
        <div id="content" tabIndex={-1} className={styles.content}>
          {children}
        </div>
      </div>
      <TabBar />
    </div>
  );
}
