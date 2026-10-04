// Runs once when the server starts: applies database migrations and, if no
// account exists yet, prints the one-time setup code for the first admin.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("./lib/db");
  const { userCount } = await import("./lib/auth/service");
  const { setupCode } = await import("./lib/auth/setup-code");
  const db = await getDb();
  if ((await userCount(db)) === 0) {
    console.log(`\n  Neolibrary setup: open /setup and enter this code to create the owner account: ${setupCode()}\n`);
  }
}
