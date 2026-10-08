import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { AccountForms } from "./AccountForms";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

/** Password and other browsers for the signed-in person. */
export default async function AccountPage() {
  const user = await requireUser();
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>You</p>
      <h1 className={styles.title}>Account</h1>
      <p className={styles.lede}>
        Signed in as {user.name} ({user.email}).
      </p>
      <AccountForms />
    </main>
  );
}
