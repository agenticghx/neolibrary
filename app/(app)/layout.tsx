import Link from "next/link";
import { Mark } from "@/components/Mark";
import { requireUser } from "@/lib/auth/session";
import { signOutAction } from "./actions";
import styles from "./layout.module.css";

// Everything under (app) needs a signed-in user, checked against the database.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/" className={styles.brand}>
          <Mark size={26} />
          <span className={styles.wordmark}>Neolibrary</span>
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          <Link href="/">Library</Link>
          {user.role === "admin" ? <Link href="/admin/invites">Invite</Link> : null}
          <form action={signOutAction}>
            <button type="submit" className={styles.signOut}>
              Sign out
            </button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}
