import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getPreferences } from "@/lib/library/preferences";
import { AccountForms } from "./AccountForms";
import { ReadingPreferences } from "./ReadingPreferences";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

/** Reading preferences, the password and other browsers for the signed-in person. */
export default async function AccountPage() {
  const user = await requireUser();
  const preferences = await getPreferences(await getDb(), user.id);
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>You</p>
      <h1 className={styles.title}>Account</h1>
      <p className={styles.lede}>
        Signed in as {user.name} ({user.email}).
      </p>
      <ReadingPreferences initial={preferences} />
      <AccountForms />
    </main>
  );
}
