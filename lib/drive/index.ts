import { FakeDrive } from "./fake";
import { PublicDrive, type DriveSource } from "./drive";

export { DriveError, parseDriveLink, type DriveSource } from "./drive";

/** Google Drive, or the fake one in tests (DRIVE_FAKE=1, or under Vitest). */
export function getDrive(env: Record<string, string | undefined> = process.env): DriveSource {
  return env.DRIVE_FAKE === "1" || env.VITEST ? new FakeDrive() : new PublicDrive();
}
