import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getBook } from "@/lib/library/paths";
import { isCfi } from "@/lib/library/reading";
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
  searchParams: Promise<{ at?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const found = await getBook(db, user.id, (await params).id);
  if (!found || !found.owned || !found.book.fileType) notFound();
  const { book } = found;
  // ?at=<cfi> (e.g. from a search result) opens at that spot instead of the saved one.
  const at = (await searchParams).at;
  const fileUrl = signFileUrl(await serverSecret(db, "file-links"), book.fileKey!);
  return (
    <Reader
      bookId={book.id}
      title={book.title}
      author={book.author}
      fileUrl={fileUrl}
      fileType={book.fileType!}
      initialCfi={isCfi(at) ? at : book.position}
      initialFraction={book.progress}
    />
  );
}
