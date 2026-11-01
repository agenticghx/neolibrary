/**
 * M40 S6: the parts of the overnight scan reading (scripts/overnight-scans.ts) that need no network or model: which
 * books to read, each one's folder, how the reading went, and the draft note Samuel reads. Written for Claude sessions.
 */
import type { AgentBookDetails } from "@/lib/agent/library";

/** Scans with no text edition and no draft already waiting for Samuel's "send", in shelf order. */
export function pickScans(books: AgentBookDetails[], draftWaiting: (b: AgentBookDetails) => boolean) {
  return books.filter((b) => b.kind === "pdf" && b.scan && !b.textEdition && !b.editionOf && !draftWaiting(b));
}

/** A book's folder name: its title made safe for a folder, and the start of its id so two same titles never meet. */
export function slugFor(book: Pick<AgentBookDetails, "id" | "title">) {
  const words = book.title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${words || "book"}-${book.id.slice(0, 8)}`;
}

/** Pages not read, from the reading script's last line ("Done: 12 pages read now, 2 blank, 0 not read."); null if absent. */
export function notReadCount(out: string): number | null {
  const m = /Done: \d+ pages read now, \d+ blank, (\d+) not read/.exec(out);
  return m ? Number(m[1]) : null;
}

export function draftNote(d: {
  book: Pick<AgentBookDetails, "id" | "title" | "author">;
  site: string;
  folder: string;
  status: "ready" | "partial";
  why?: string;
  check?: string;
  problems?: boolean;
}) {
  const send = `npx tsx scripts/text-edition-on-subscription.ts send "${d.folder}" ${d.site} ${d.book.id}`;
  const lines = [
    `# ${d.book.title}${d.book.author ? `, ${d.book.author}` : ""}: text edition draft`,
    "",
    `Status: ${d.status}`,
    "",
    "Written for Samuel by scripts/overnight-scans.ts (M40 S6). Nothing has been sent to the site.",
    "",
  ];
  if (d.status === "partial") {
    lines.push(`Not finished: ${d.why ?? "the reading stopped"}. The next run carries on from the pages not read yet.`);
  } else {
    lines.push(
      d.problems ? "The check flagged pages to look at (below). Look at them in preview.epub before sending." : "The check found nothing to look at.",
      "",
      "To put it on the site, tell a Claude session \"send\", or run in a login shell from the repository:",
      "",
      "    " + send,
      "",
      "## The check",
      "",
      "```",
      (d.check ?? "").trim().slice(-6000),
      "```",
    );
  }
  return lines.join("\n") + "\n";
}
