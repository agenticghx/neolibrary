import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/AuthShell";
import styles from "@/components/forms.module.css";
import { currentUser, safeNext } from "@/lib/auth/session";
import { signInAction } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return (
    <AuthShell title="Welcome back">
      <ActionForm action={signInAction} submitLabel="Sign in" pendingLabel="Signing in…">
        <input type="hidden" name="next" value={next} />
        <Field label="Email address" name="email" type="email" autoComplete="email" placeholder="you@example.com" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
      </ActionForm>
      <p className={styles.note}>New here? Use the invitation link you were sent.</p>
    </AuthShell>
  );
}
