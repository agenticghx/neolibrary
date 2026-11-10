import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { visitorCoverSigner } from "@/lib/library/covers";
import { freeBookToRead } from "@/lib/library/open-shelf";
import { Reader } from "@/app/(reader)/books/[id]/read/Reader";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const book = await freeBookToRead(await getDb(), (await params).id);
  return { title: book ? `Reading ${book.title}` : "Not found" };
}

/**
 * M34 S3: a free book in the reader, for anyone, signed in or not. Its own route group, so the open shelf's bar
 * is not drawn over the reader. A book that is not free to read is "not found". The reader keeps the visitor's
 * place in their browser and saves nothing on the server (Reader's `visitor`).
 */
export default async function VisitorReadPage({ params }: { params: Promise<{ id: string }> }) {
  const db = await getDb();
  const book = await freeBookToRead(db, (await params).id);
  if (!book) notFound();
  // The same short-lived visitor link as a cover's; /api/open/files hands it out only while the book is free to read.
  const fileUrl = (await visitorCoverSigner())(book.fileKey)!;
  return (
    <Reader
      readerId=""
      bookId={book.id}
      title={book.title}
      author={book.author}
      fileUrl={fileUrl}
      fileType={book.fileType}
      initialCfi={null}
      initialFraction={0}
      rewrittenView="original"
      visitor={{ backHref: `/browse/${book.id}` }}
    />
  );
}
