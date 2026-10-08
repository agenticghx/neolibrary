import type { Metadata } from "next";
import Link from "next/link";
import { listInvites, listReaders } from "@/lib/auth/service";
import { requireAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { revokeInviteAction, setReaderDisabledAction } from "../../actions";
import { InviteForm } from "./InviteForm";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Invite people" };
export const dynamic = "force-dynamic";

const STATUS = { open: "Waiting", used: "Joined", expired: "Expired", revoked: "Withdrawn" } as const;
const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function InvitesPage() {
  await requireAdmin();
  const db = await getDb();
  const invites = await listInvites(db);
  const readers = await listReaders(db);
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Admin</p>
      <h1 className={styles.title}>Invite people</h1>
      <p className={styles.lede}>
        Nobody can sign up on their own. Make a link for each person you trust; they choose their own password.
      </p>
      <p className={styles.lede}>
        <Link href="/admin/costs" className={styles.costsLink}>
          Spending this month
        </Link>{" "}
        on Claude and ElevenLabs, against the caps.
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
      <section aria-labelledby="readers" className={styles.list}>
        <h2 id="readers" className={styles.listTitle}>
          Readers
        </h2>
        <p className={styles.lede}>
          Disable signs that person out and stops them signing in. Enable lets them sign in again. You cannot disable
          your own account.
        </p>
        {readers.length === 0 ? (
          <p className={styles.empty}>No readers yet.</p>
        ) : (
          <ul className={styles.rows} data-testid="reader-rows">
            {readers.map((r) => (
              <li key={r.id} className={styles.row}>
                <span className={styles.note}>{r.name}</span>
                <span className={styles.meta}>
                  {r.email} · {r.disabledAt ? `Disabled ${date(r.disabledAt)}` : "Can sign in"}
                </span>
                <form action={setReaderDisabledAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="disabled" value={r.disabledAt ? "0" : "1"} />
                  <button type="submit" className={styles.revoke} aria-label={`${r.disabledAt ? "Enable" : "Disable"} ${r.name}`}>
                    {r.disabledAt ? "Enable" : "Disable"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
