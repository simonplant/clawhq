/**
 * Permission enforcement for .env files.
 *
 * Ensures .env files are chmod 600 (owner read/write only).
 */

import { chmod, stat } from "node:fs/promises";

export interface PermissionStatus {
  path: string;
  mode: number;
  correct: boolean;
}

/**
 * Check if a .env file has correct permissions (0600).
 * Returns null if the file does not exist.
 */
export async function checkEnvPermissions(
  path: string,
): Promise<PermissionStatus | null> {
  try {
    const s = await stat(path);
    const mode = s.mode & 0o777;
    return {
      path,
      mode,
      correct: mode === 0o600,
    };
  } catch {
    return null;
  }
}

/**
 * Enforce correct permissions on a .env file (chmod 600).
 * Returns true if permissions were changed, false if already correct.
 * Throws if the file does not exist or chmod fails.
 */
export async function enforceEnvPermissions(path: string): Promise<boolean> {
  const s = await stat(path);
  const mode = s.mode & 0o777;
  if (mode === 0o600) {
    return false;
  }
  await chmod(path, 0o600);
  return true;
}
