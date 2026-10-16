import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
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
  searchParams: Promise<{ at?: string; listen?: string; page?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const found = await getBook(db, user.id, (await params).id);
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
      edition={edition}
      openPage={openPage}
      initialFraction={book.progress}
      startListening={sp.listen === "1" && found.available.listen}
      rewrittenView={rewrittenView}
    />
  );
}
