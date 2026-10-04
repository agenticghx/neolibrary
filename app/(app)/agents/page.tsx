import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { listApiTokens } from "@/lib/auth/tokens";
import { getDb } from "@/lib/db";
import { revokeTokenAction } from "../actions";
import forms from "@/components/forms.module.css";
import styles from "../admin/invites/page.module.css";
import { TokenForm } from "./TokenForm";

export const metadata: Metadata = { title: "Agent access" };
export const dynamic = "force-dynamic";

const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Personal API tokens (M11): let an AI agent use your library as you, and take that back at any time. */
export default async function AgentsPage() {
  const user = await requireUser();
  const tokens = await listApiTokens(await getDb(), user.id);
  const h = await headers();
  const mcpUrl = `${h.get("x-forwarded-proto") === "https" ? "https" : "http"}://${h.get("host") ?? "localhost"}/api/agent/mcp`;
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Your data</p>
      <h1 className={styles.title}>Agent access</h1>
      <p className={styles.lede}>
        An AI agent (such as Claude on your computer) can use your library for you: list your books, search their text,
        read your highlights and notes, and add notes. It needs a token, a long secret you make here. It sees only what
        you see, and you can revoke it at any moment.
      </p>
      <TokenForm />
      <section aria-labelledby="connect" className={styles.list}>
        <h2 id="connect" className={styles.listTitle}>
          Connect an agent
        </h2>
        <p className={styles.lede}>
          Agents connect through MCP (the Model Context Protocol, the standard way AI agents plug into tools) at this
          address, sending the token with every request:
        </p>
        <input className={forms.input} readOnly value={mcpUrl} aria-label="MCP server address" data-testid="mcp-url" />
        <p className={styles.lede}>
          For Claude Code, run this in a terminal, with your token in place of <em>YOUR_TOKEN</em>:
        </p>
        <textarea
          className={forms.input}
          readOnly
          rows={3}
          value={`claude mcp add --transport http neolibrary ${mcpUrl} --header "Authorization: Bearer YOUR_TOKEN"`}
          aria-label="Command to connect Claude Code"
        />
        <p className={styles.empty}>
          The agent can then list your books, search their text, read your notes and add notes (each marked as the
          agent&apos;s).
        </p>
      </section>
      <section aria-labelledby="tokens" className={styles.list}>
        <h2 id="tokens" className={styles.listTitle}>
          Your tokens
        </h2>
        {tokens.length === 0 ? (
          <p className={styles.empty}>None yet.</p>
        ) : (
          <ul className={styles.rows} data-testid="token-rows">
            {tokens.map((t) => (
              <li key={t.id} className={styles.row}>
                <span className={styles.note}>
                  {t.name} <code>{t.prefix}…</code>
                </span>
                <span className={styles.meta}>
                  {t.revokedAt ? `Revoked ${date(t.revokedAt)}` : t.lastUsedAt ? `Last used ${date(t.lastUsedAt)}` : "Not used yet"} · made{" "}
                  {date(t.createdAt)}
                </span>
                {t.revokedAt ? (
                  <span />
                ) : (
                  <form action={revokeTokenAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className={styles.revoke} aria-label={`Revoke ${t.name}`}>
                      Revoke
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
