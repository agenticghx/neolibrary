import { getDb } from "@/lib/db";
import { serverSecret } from "@/lib/secrets";
import { FILE_LINK_SECONDS, signFileUrl, VISITOR_FILE_BASE } from "@/lib/signed-url";

/** Returns a function that turns a stored cover key into a short-lived signed URL. */
export async function coverSigner(): Promise<(key: string | null) => string | null> {
  const secret = await serverSecret(await getDb(), "file-links");
  const now = Date.now();
  return (key) => (key ? signFileUrl(secret, key, now) : null);
}

/** M34: the same for a visitor's page, with the visitor links' own secret and route (lib/signed-url.ts). */
export async function visitorCoverSigner(): Promise<(key: string | null) => string | null> {
  const secret = await serverSecret(await getDb(), "visitor-file-links");
  const now = Date.now();
  return (key) => (key ? signFileUrl(secret, key, now, FILE_LINK_SECONDS, VISITOR_FILE_BASE) : null);
}
