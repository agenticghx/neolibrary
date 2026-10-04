import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { costReport, SERVICES } from "@/lib/library/costs";
import styles from "../invites/page.module.css";
import own from "./page.module.css";

export const metadata: Metadata = { title: "Spending" };
export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n < 1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`;
/** "Claude $0.012 · ElevenLabs $0.030" for the services a book used. */
const split = (byProvider: Record<string, number>) =>
  SERVICES.filter((s) => byProvider[s.provider])
    .map((s) => `${s.short} ${usd(byProvider[s.provider])}`)
    .join(" · ");

/** The running cost counter for paid services (M7, ground rule 8). */
export default async function CostsPage() {
  const admin = await requireAdmin();
  const report = await costReport(await getDb(), admin.id);
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Admin</p>
      <h1 className={styles.title}>Spending this month</h1>
      <p className={styles.lede}>
        What the paid services have cost since the 1st, for everyone you invited. Each stops at its cap; saved answers,
        audio and pictures are free to use again. Caps reset on the 1st.
      </p>
      <section aria-labelledby="services" className={own.services}>
        <h2 id="services" className={styles.listTitle}>
          Services
        </h2>
        {report.services.map((s) => (
          <div key={s.provider} className={own.service} data-testid={`cost-${s.provider}`}>
            <p className={own.serviceName}>{s.label}</p>
            <p className={own.amount}>
              <span data-testid={`spent-${s.provider}`}>{usd(s.spentUsd)}</span> of {usd(s.capUsd)}
            </p>
            <progress className={own.meter} max={s.capUsd || 1} value={Math.min(s.spentUsd, s.capUsd)} aria-label={`${s.label}: share of this month's cap used`} />
            <p className={own.meta}>
              {s.calls} paid {s.calls === 1 ? "request" : "requests"} · cap per book {usd(s.perBookCapUsd)} · set with{" "}
              <code>{s.caps}_CAP_PER_MONTH_USD</code> and <code>{s.caps}_CAP_PER_BOOK_USD</code>
            </p>
          </div>
        ))}
      </section>
      <section aria-labelledby="books" className={styles.list}>
        <h2 id="books" className={styles.listTitle}>
          By book
        </h2>
        {report.books.length === 0 && Object.keys(report.others).length === 0 ? (
          <p className={styles.empty}>Nothing spent yet this month.</p>
        ) : (
          <ul className={styles.rows} data-testid="cost-books">
            {report.books.map((b) => (
              <li key={b.bookId} className={own.bookRow}>
                <Link href={`/books/${b.bookId}`}>{b.title}</Link>
                <span className={styles.meta}>{split(b.byProvider)}</span>
              </li>
            ))}
            {Object.keys(report.others).length ? (
              <li className={own.bookRow}>
                <span>Other readers&apos; books</span>
                <span className={styles.meta}>{split(report.others)}</span>
              </li>
            ) : null}
          </ul>
        )}
      </section>
    </main>
  );
}
