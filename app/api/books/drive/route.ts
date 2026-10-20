import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getDrive } from "@/lib/drive";
import { jsonAtMost } from "@/lib/http-body";
import { importFromDrive } from "@/lib/library/drive-import";
import { ImportError } from "@/lib/library/ebook";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Adds books from a Google Drive link (M30): `{ link, attachTo? }`, a file or a folder shared as "Anyone with the
 * link". Answers `{ results }` in the shape of /api/books, one line per file.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await jsonAtMost(req, 4096);
  if (body instanceof Response) return body;
  const { link, attachTo } = (body ?? {}) as { link?: unknown; attachTo?: unknown };
  try {
    const results = await importFromDrive({ db: await getDb(), storage: await getStorage(), drive: getDrive() }, user.id, link, {
      attachTo: typeof attachTo === "string" ? attachTo : null,
    });
    return Response.json({ results });
  } catch (e) {
    if (e instanceof ImportError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
