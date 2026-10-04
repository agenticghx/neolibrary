import type { Metadata } from "next";
import { listInvites } from "@/lib/auth/service";
import { requireAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { revokeInviteAction } from "../../actions";
import { InviteForm } from "./InviteForm";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Invite people" };
export const dynamic = "force-dynamic";

const STATUS = { open: "Waiting", used: "Joined", expired: "Expired", revoked: "Withdrawn" } as const;
const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function InvitesPage() {
  await requireAdmin();
  const invites = await listInvites(await getDb());
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Admin</p>
      <h1 className={styles.title}>Invite people</h1>
      <p className={styles.lede}>
        Nobody can sign up on their own. Make a link for each person you trust; they choose their own password.
      </p>
      <InviteForm />
      <section aria-labelledby="sent" className={styles.list}>
        <h2 id="sent" className={styles.listTitle}>
          Invitations
        </h2>
        {invites.length === 0 ? (
          <p className={styles.empty}>None yet.</p>
        ) : (
          <ul className={styles.rows} data-testid="invite-rows">
            {invites.map((i) => (
              <li key={i.id} className={styles.row}>
                <span className={styles.note}>{i.note || "Untitled invitation"}</span>
                <span className={styles.meta}>
                  {STATUS[i.status]} · made {date(i.createdAt)}
                </span>
                {i.status === "open" ? (
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <button type="submit" className={styles.revoke}>
                      Withdraw
                    </button>
                  </form>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
