import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { currentCoverRun, startCoverRun } from "@/lib/library/cover-job";
import { coverCounts } from "@/lib/library/cover-lookup";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Covers (M22). GET: how many of the reader's titles have a found cover and how many have none, and whether a
 * lookup is running for them (with its progress when it is theirs alone). POST, "Find covers now": looks up every
 * title of theirs without a cover, even one asked about lately; 409 while another reader's lookup runs.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const run = currentCoverRun();
  const counts = await coverCounts(await getDb(), user.id);
  return Response.json({
    ...counts,
    looking: Boolean(run && (run.ownerId === null || run.ownerId === user.id)),
    // Progress only for a run of the reader's own (one for everyone counts other readers' titles).
    progress: run && run.ownerId === user.id ? run.progress : null,
  });
}

export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const running = currentCoverRun();
  if (running && running.ownerId !== user.id) {
    return Response.json({ error: "Covers are being looked up for the library now. Try again in a few minutes." }, { status: 409 });
  }
  const run = startCoverRun(await getDb(), await getStorage(), { ownerId: user.id, force: true });
  run.promise.catch((e) => console.error("Cover lookup failed", e));
  return Response.json({ looking: true, progress: run.progress }, { status: 202 });
}
