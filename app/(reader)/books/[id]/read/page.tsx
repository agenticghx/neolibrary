import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getBook } from "@/lib/library/paths";
import { serverSecret } from "@/lib/secrets";
import { signFileUrl } from "@/lib/signed-url";
import { Reader } from "./Reader";

export const metadata: Metadata = { title: "Reading" };
export const dynamic = "force-dynamic";

export default async function ReadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const db = await getDb();
  const found = await getBook(db, user.id, (await params).id);
  if (!found || !found.owned || found.book.fileType !== "epub") notFound();
  const { book } = found;
  const fileUrl = signFileUrl(await serverSecret(db, "file-links"), book.fileKey!);
  return (
    <Reader
      bookId={book.id}
      title={book.title}
      author={book.author}
      fileUrl={fileUrl}
      initialCfi={book.position}
      initialFraction={book.progress}
    />
  );
}
