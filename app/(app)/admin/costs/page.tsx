import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { modelTable } from "@/lib/ai/model-picks";
import { MODEL_CHOICES, PRICES } from "@/lib/ai/model";
import { costReport, SERVICES } from "@/lib/library/costs";
import { ModelForm } from "./ModelForm";
import styles from "../invites/page.module.css";
import own from "./page.module.css";

export const metadata: Metadata = { title: "Spending" };
export const dynamic = "force-dynamic";

/** "Haiku 5.5" for "claude-haiku-5-5". */
const modelName = (id: string) =>
  id.replace(/^claude-/, "").replace(/^(\w)(\w*)-(\d+)-(\d+)$/, (_, a: string, b: string, x: string, y: string) => `${a.toUpperCase()}${b} ${x}.${y}`);
const perMillion = (n: number) => `$${n < 1 ? n.toFixed(2) : n}`;

const usd = (n: number) => `$${n < 1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`;
/** "Claude $0.012 · ElevenLabs $0.030" for the services a book used. */
const split = (byProvider: Record<string, number>) =>
  SERVICES.filter((s) => byProvider[s.provider])
    .map((s) => `${s.short} ${usd(byProvider[s.provider])}`)
    .join(" · ");

/** The running cost counter for paid services (M7, ground rule 8). */
export default async function CostsPage() {
  const admin = await requireAdmin();
  const db = await getDb();
  const report = await costReport(db, admin.id);
  const models = await modelTable(db);
  const choices = MODEL_CHOICES.map((id) => ({
    id,
    name: modelName(id),
    price: `${perMillion(PRICES[id].input)} in, ${perMillion(PRICES[id].output)} out`,
  }));
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Admin</p>
      <h1 className={styles.title}>Spending this month</h1>
      <p className={styles.lede}>
        What the library&apos;s keys have cost since the 1st (invited readers use their own keys; whole-book work run on
        these keys is included). Each stops at its cap; saved answers, audio and pictures are free to use again. Caps
        reset on the 1st.
      </p>
      <section aria-labelledby="services" className={own.services}>
        <h2 id="services" className={styles.listTitle}>
          Services
        </h2>
        {report.services.map((s) => {
          const share = s.capUsd > 0 ? Math.min(100, Math.round((s.spentUsd / s.capUsd) * 100)) : 0;
          const shareLabel = s.spentUsd > 0 && share === 0 ? "< 1% used" : `${share}% used`;
          return (
            <div key={s.provider} className={own.service} data-testid={`cost-${s.provider}`}>
              <div className={own.serviceHead}>
                <p className={own.serviceName}>{s.label}</p>
                <span className={own.shareBadge}>{shareLabel}</span>
              </div>
              <p className={own.amount}>
                <span data-testid={`spent-${s.provider}`}>{usd(s.spentUsd)}</span>{" "}
                <span className={own.capOf}>of {usd(s.capUsd)}</span>
              </p>
              <progress className={own.meter} max={s.capUsd || 1} value={Math.min(s.spentUsd, s.capUsd)} aria-label={`${s.label}: share of this month's cap used`} />
              <p className={own.meta}>
                {s.calls} paid {s.calls === 1 ? "request" : "requests"} · cap per book {usd(s.perBookCapUsd)}
              </p>
              {s.heldUsd > 0 ? (
                <p className={own.meta} data-testid={`held-${s.provider}`}>
                  Also held against the cap: {usd(s.heldUsd)} for calls not finished (still running, or cut off when the
                  server restarted; those may have been charged, so they stay counted).
                </p>
              ) : null}
            </div>
          );
        })}
        <details className={own.config}>
          <summary className={own.configSummary}>Cap environment variables</summary>
          <ul className={own.configList}>
            {report.services.map((s) => (
              <li key={s.provider}>
                {s.label}: <code>{s.caps}_CAP_PER_MONTH_USD</code> and <code>{s.caps}_CAP_PER_BOOK_USD</code>
              </li>
            ))}
          </ul>
        </details>
      </section>
      <section aria-labelledby="models" className={styles.list}>
        <h2 id="models" className={styles.listTitle}>
          Which Claude model answers
        </h2>
        <p className={own.meta}>
          Only you can change these: they pick which Claude model answers in the library. Prices are per million tokens
          (about 750,000 words) read in and written out. Saved answers stay free and keep their model&apos;s name; a new
          question or “ask again” uses the model chosen here.
        </p>
        <ModelForm rows={models.map((m) => ({ feature: m.feature, label: m.label, fallback: m.fallback, picked: m.picked }))} choices={choices} />
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
                <span className={styles.meta}>{split(b.byProvider) || "$0.00"}</span>
              </li>
            ))}
            {Object.keys(report.others).length ? (
              <li className={own.bookRow}>
                <span>Other readers&apos; books</span>
                <span className={styles.meta}>{split(report.others) || "$0.00"}</span>
              </li>
            ) : null}
          </ul>
        )}
      </section>
    </main>
  );
}
