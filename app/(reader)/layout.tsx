import { CommandPalette } from "@/components/palette/CommandPalette";
import { requireUser } from "@/lib/auth/session";

// The reader has its own full-screen chrome (no app bar); still behind login.
// Cmd+K or Ctrl+K opens the command palette here too (M21); the reader's own keys never use Cmd or Ctrl.
export default async function ReaderLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      {children}
      <CommandPalette admin={user.role === "admin"} />
    </>
  );
}
