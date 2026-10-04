import { getDb } from "@/lib/db";
import { serverSecret } from "@/lib/secrets";
import { signFileUrl } from "@/lib/signed-url";

/** Returns a function that turns a stored cover key into a short-lived signed URL. */
export async function coverSigner(): Promise<(key: string | null) => string | null> {
  const secret = await serverSecret(await getDb(), "file-links");
  const now = Date.now();
  return (key) => (key ? signFileUrl(secret, key, now) : null);
}
