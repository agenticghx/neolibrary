import Link from "next/link";
import { Mark } from "@/components/Mark";
import { currentUser } from "@/lib/auth/session";
import styles from "./open.module.css";

// M34, the open shelf: pages anyone may see, signed in or not (docs/plan.md).
// They show only the owner's books that are on the shelf, through
// lib/library/open-shelf.ts, and never a note, highlight, place or count.
export default async function OpenLayout({ children }: { children: React.ReactNode }) {
  const signedIn = Boolean(await currentUser());
  return (
    <div className={styles.room}>
      <header className={styles.bar}>
        <Link href="/browse" className={styles.brand}>
          <Mark size={28} />
          <span className={styles.wordmark}>Neolibrary</span>
        </Link>
        <Link href={signedIn ? "/" : "/sign-in"} className={styles.signIn}>
          {signedIn ? "Your library" : "Sign in"}
        </Link>
      </header>
      {children}
    </div>
  );
}
