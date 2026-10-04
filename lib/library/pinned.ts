/**
 * Pictures pinned to passages (M9). A pinned picture is either from
 * Wikimedia Commons (with its credit and licence, always shown) or generated
 * (a stored file, always labelled as generated). Shared by server and reader.
 */
export type PinnedPicture =
  | {
      source: "wikimedia";
      title: string;
      thumbUrl: string;
      imageUrl: string;
      pageUrl: string;
      credit: string;
      licence: string;
      licenceUrl: string | null;
    }
  | { source: "generated"; key: string; subject: string; model: string };

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const commonsImage = (u: string) => /^https:\/\/upload\.wikimedia\.org\/[^\s"'<>]+$/.test(u) || /^\/fake-images\/[a-z0-9-]+\.svg$/.test(u);
const webPage = (u: string) => /^https:\/\/[^\s"'<>]+$/.test(u);

/** Checks a picture from the browser before it is stored; null if it is not one the app can pin. */
export function cleanPicture(input: unknown, ownerId: string): PinnedPicture | null {
  const p = input as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return null;
  if (p.source === "generated") {
    const key = str(p.key, 300);
    if (!new RegExp(`^images/${ownerId}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.png$`).test(key)) return null;
    return { source: "generated", key, subject: str(p.subject, 120), model: str(p.model, 80) };
  }
  if (p.source === "wikimedia" || p.source === "fake") {
    const thumbUrl = str(p.thumbUrl, 1000);
    const imageUrl = str(p.imageUrl, 1000);
    const pageUrl = str(p.pageUrl, 1000);
    const licenceUrl = str(p.licenceUrl, 1000);
    if (!commonsImage(thumbUrl) || !commonsImage(imageUrl) || !webPage(pageUrl)) return null;
    return {
      source: "wikimedia",
      title: str(p.title, 200) || "Untitled",
      thumbUrl,
      imageUrl,
      pageUrl,
      credit: str(p.credit, 300) || "Unknown author",
      licence: str(p.licence, 120) || "See the file page",
      licenceUrl: licenceUrl && webPage(licenceUrl) ? licenceUrl : null,
    };
  }
  return null;
}

/** The picture in one line of text: for exports and the old schema. */
export function pictureText(p: PinnedPicture) {
  return p.source === "generated"
    ? `Generated picture: ${p.subject} (made by AI, ${p.model})`
    : `Picture: ${p.title}, by ${p.credit}, ${p.licence} (${p.pageUrl})`;
}

/** The pin badge drawn in the margin beside a pinned picture's passage (24 × 24 grid). */
export const PICTURE_PATHS = ["M4.5 6.5h15v11h-15z", "M4.5 15l4-4 3 3 2.5-2.5 5.5 5.5", "M15.5 9.5v.1"];
