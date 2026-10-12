import { currentUser } from "@/lib/auth/session";
import { getCoverSource } from "@/lib/covers/sources";
import { searchCovers } from "@/lib/library/cover-lookup";

export const dynamic = "force-dynamic";

/**
 * "Choose a cover" (C3a): the catalogues' records with a picture for the words the reader typed (?q=), each with
 * its preview and a code to choose it by (POST /api/covers/<book>/choose), and what a catalogue that could not be
 * asked said ({ choices, unreachable }).
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const words = (new URL(req.url).searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
  if (!words) return Response.json({ error: "Type a title or an author to search for." }, { status: 400 });
  if (words.length > 200) return Response.json({ error: "That is too long to search for." }, { status: 400 });
  return Response.json(await searchCovers(getCoverSource(), words));
}
