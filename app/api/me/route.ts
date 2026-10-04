import { currentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Who is signed in. 401 for anyone else. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json(user);
}
