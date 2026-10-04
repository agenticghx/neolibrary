import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/AuthShell";
import styles from "@/components/forms.module.css";
import { MIN_PASSWORD, userCount } from "@/lib/auth/service";
import { getDb } from "@/lib/db";
import { setupAction } from "../actions";

export const metadata: Metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if ((await userCount(await getDb())) > 0) redirect("/sign-in");
  return (
    <AuthShell title="Open the library">
      <p className={styles.note}>Create the owner account. The setup code is printed in the server log.</p>
      <ActionForm action={setupAction} submitLabel="Create owner account" pendingLabel="Creating…">
        <Field label="Setup code" name="code" autoComplete="off" />
        <Field label="Your name" name="name" autoComplete="name" />
        <Field label="Email address" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} />
      </ActionForm>
    </AuthShell>
  );
}
