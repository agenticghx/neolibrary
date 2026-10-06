import { Sidebar } from "@/components/shell/Sidebar";
import { SkipLink } from "@/components/shell/SkipLink";
import { TabBar } from "@/components/shell/TabBar";
import styles from "@/components/shell/Shell.module.css";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listPathsWithProgress } from "@/lib/library/paths";
import { listCollections } from "@/lib/library/shelf";

// Everything under (app) needs a signed-in user, checked against the database.
// The shell (M14): a sidebar on desktop; on a phone, four tabs at the bottom,
// and the account menu on Home only (Samuel's choice B, 2026-10-06): every
// other page starts with its own title.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  const [paths, collections] = await Promise.all([listPathsWithProgress(db, user.id), listCollections(db, user.id)]);
  return (
    <div className={styles.shell}>
      <SkipLink />
      <Sidebar user={user} paths={paths} collections={collections} />
      <div className={styles.column}>
        <div id="content" className={styles.content}>
          {children}
        </div>
      </div>
      <TabBar />
    </div>
  );
}
