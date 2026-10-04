import { requireUser } from "@/lib/auth/session";

// The reader has its own full-screen chrome (no app bar); still behind login.
export default async function ReaderLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return children;
}
