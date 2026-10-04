import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field } from "@/components/ActionForm";
import { AuthShell } from "@/components/AuthShell";
import styles from "@/components/forms.module.css";
import { inviteIsOpen, MIN_PASSWORD } from "@/lib/auth/service";
import { getDb } from "@/lib/db";
import { acceptInviteAction } from "../../actions";

export const metadata: Metadata = { title: "Invitation" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await inviteIsOpen(await getDb(), token))) {
    return (
      <AuthShell title="This invitation has closed">
        <p className={styles.note}>
          The link was already used, has expired or was withdrawn. Ask whoever invited you for a new one.
        </p>
        <p className={styles.note}>
          <Link href="/sign-in">Go to sign in</Link>
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="You are invited">
      <p className={styles.note}>Choose how you will sign in. Your notes and highlights stay yours.</p>
      <ActionForm action={acceptInviteAction} submitLabel="Join the library" pendingLabel="Joining…">
        <input type="hidden" name="token" value={token} />
        <Field label="Your name" name="name" autoComplete="name" />
        <Field label="Email address" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} />
      </ActionForm>
    </AuthShell>
  );
}
