import { health } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Used by Railway to decide whether a deploy is up. */
export function GET() {
  return Response.json(health());
}
