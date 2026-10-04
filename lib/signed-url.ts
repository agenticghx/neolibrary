import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/auth/crypto";

/**
 * Short-lived file links: /api/files/<key>?exp=<unix seconds>&sig=<hmac>.
 * The link only works until `exp`, only for that key and only for a signed-in
 * user (the route checks both), so a copied link stops working within minutes.
 */
export const FILE_LINK_SECONDS = 5 * 60;

function signature(secret: string, key: string, exp: number) {
  return createHmac("sha256", secret).update(`${key}\n${exp}`).digest("base64url");
}

export function signFileUrl(secret: string, key: string, now = Date.now(), ttl = FILE_LINK_SECONDS): string {
  const exp = Math.floor(now / 1000) + ttl;
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `/api/files/${path}?exp=${exp}&sig=${signature(secret, key, exp)}`;
}

export function verifyFileSignature(
  secret: string,
  key: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
): boolean {
  const e = Number(exp);
  if (!exp || !sig || !Number.isInteger(e) || e * 1000 < now) return false;
  return safeEqual(sig, signature(secret, key, e));
}
