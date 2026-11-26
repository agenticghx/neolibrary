import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { ReaderMap } from "./ReaderMap";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Get help" };

/**
 * Get help (M33, redesigned 2026-11-26 per Samuel's pick: Option B interactive reader map
 * paired with Option A's compact quick-links footer). Minimal, icon-driven, plain English.
 */
export default async function HelpPage() {
  const user = await requireUser();
  const admin = user.role === "admin";

  const pillars = [
    {
      href: "/import",
      title: "Import",
      sub: "EPUB, PDF, MD, Drive & Papers",
      icon: (
        <svg className={styles.tileIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
        </svg>
      ),
    },
    {
      href: "/paths",
      title: "Paths",
      sub: "Ordered reading plans",
      icon: (
        <svg className={styles.tileIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
        </svg>
      ),
    },
    {
      href: "/review",
      title: "Review & Stats",
      sub: "Spaced cards & reading pace",
      icon: (
        <svg className={styles.tileIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        </svg>
      ),
    },
    {
      href: "/data",
      title: "Your data",
      sub: "Full export, restore & agents",
      icon: (
        <svg className={styles.tileIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
    },
  ];

  const quickLinks: { href: string; label: string }[] = [
    { href: "/import", label: "Import" },
    { href: "/paths", label: "Paths" },
    { href: "/review", label: "Daily review" },
    { href: "/stats", label: "Reading stats" },
    { href: "/data", label: "Your data" },
    { href: "/agents", label: "Agent access" },
    ...(admin
      ? [
          { href: "/covers", label: "Covers" },
          { href: "/admin/invites", label: "Invite" },
          { href: "/admin/costs", label: "Spending" },
        ]
      : [{ href: "/account", label: "Your own keys" }]),
  ];

  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Get help</p>
          <h1 className={styles.title}>How the library works</h1>
        </div>
        <p className={styles.tagline}>Private library · DRM-free · Zero lock-in</p>
      </header>

      <ReaderMap isAdmin={admin} />

      <section aria-label="Around the library" className={styles.tiles}>
        {pillars.map((p) => (
          <Link key={p.href} href={p.href} className={styles.tile}>
            <span className={styles.tileBadge}>{p.icon}</span>
            <span className={styles.tileBody}>
              <span className={styles.tileTitle}>{p.title}</span>
              <span className={styles.tileSub}>{p.sub}</span>
            </span>
          </Link>
        ))}
      </section>

      <section aria-labelledby="quick-links-h" className={styles.footerBar}>
        <h2 id="quick-links-h" className={styles.footerTitle}>
          {admin ? "Quick links & Owner tools" : "Quick links"}
        </h2>
        <nav aria-label="Quick links" className={styles.linkPills}>
          {quickLinks.map((l) => (
            <Link key={l.href} href={l.href} className={styles.linkPill}>
              {l.label}
            </Link>
          ))}
        </nav>
      </section>

      <p className={styles.shortcuts}>
        <strong>Shortcuts:</strong> Left / Right arrows turn pages · <strong>F</strong> full screen · <strong>Esc</strong> close panels
      </p>
    </main>
  );
}
