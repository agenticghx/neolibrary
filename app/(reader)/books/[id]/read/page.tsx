import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { books } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { focusRedirect, isRunning, openFocus } from "@/lib/library/focus-lock";
import { getBook } from "@/lib/library/paths";
import { getPreferences } from "@/lib/library/preferences";
import { isCfi } from "@/lib/library/reading";
import { editionOf } from "@/lib/library/text-edition";
import { serverSecret } from "@/lib/secrets";
import { signFileUrl } from "@/lib/signed-url";
import { Reader } from "./Reader";

export const metadata: Metadata = { title: "Reading" };
export const dynamic = "force-dynamic";

export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ at?: string; listen?: string; page?: string; view?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const id = (await params).id;
  // M26 R4a: while a focus session runs, any other book sends the reader to the focused one. Checked here, in the
  // page, because the reader's layout is not run again when the command palette opens another book.
  const focus = await openFocus(db, user.id);
  const to = focusRedirect(focus && isRunning(focus) ? focus : null, `/books/${id}/read`);
  if (to) redirect(to);
  const found = await getBook(db, user.id, id);
  if (!found || !found.available.read || !found.book.fileType) notFound();
  const { book } = found;
  // ?at=<cfi> (e.g. from a search result) opens at that spot instead of the saved one.
  const sp = await searchParams;
  const at = sp.at;
  const fileUrl = signFileUrl(await serverSecret(db, "file-links"), book.fileKey!);
  // M25: a scanned PDF with a text edition (a book of its own), or that edition: the reader offers Scan | Text.
  // ?page=<n> opens the text edition at the marker of the scan's page n.
  const text = book.editionOf ? { id: book.id } : await editionOf(db, user.id, book.id);
  const edition = text
    ? { scanId: book.editionOf ?? book.id, textId: text.id, current: book.editionOf ? ("text" as const) : ("scan" as const) }
    : undefined;
  // Text by default (Samuel, 2026-10-17): a scan with a text edition opens the edition, at the edition's own place,
  // or, first time, at the page reached in the scan. The scan opens only when asked for: Scan in the footer
  // (?view=scan) or a place in it (?at=, e.g. a search result).
  // Not while a focus session is on this scan: the text edition would send the reader straight back here.
  if (edition?.current === "scan" && sp.view !== "scan" && !isCfi(at) && focus?.bookId !== book.id) {
    const [own] = await db.select({ position: books.position }).from(books).where(and(eq(books.id, edition.textId), eq(books.ownerId, user.id)));
    const scanPage = Number(/^epubcfi\(\/6\/(\d+)/.exec(book.position ?? "")?.[1]) / 2;
    const q = new URLSearchParams();
    if (!own?.position && Number.isInteger(scanPage) && scanPage > 0) q.set("page", String(scanPage));
    if (sp.listen === "1") q.set("listen", "1");
    redirect(`/books/${edition.textId}/read${q.size ? `?${q}` : ""}`);
  }
  const page = Number(sp.page);
  const openPage = edition?.current === "text" && Number.isInteger(page) && page > 0 ? page : undefined;
  const { rewrittenView } = await getPreferences(db, user.id);
  return (
    <Reader
      bookId={book.id}
      title={book.title}
      author={book.author}
      fileUrl={fileUrl}
      fileType={book.fileType!}
      initialCfi={isCfi(at) ? at : openPage ? null : book.position}
      savedCfi={book.position}
      edition={edition}
      openPage={openPage}
      initialFraction={book.progress}
      startListening={sp.listen === "1" && found.available.listen}
      rewrittenView={rewrittenView}
    />
  );
}
