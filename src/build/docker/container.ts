/**
 * Resolve the running openclaw container name.
 *
 * Compose may or may not set `container_name: openclaw`; without it the
 * default form is `<project>-<service>-<index>` (e.g. `engine-openclaw-1`).
 * Probing by the compose service label avoids hardcoding either shape.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FALLBACK = "engine-openclaw-1";

export async function resolveOpenclawContainer(
  signal?: AbortSignal,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "ps",
        "--filter",
        "label=com.docker.compose.service=openclaw",
        "--format",
        "{{.Names}}",
      ],
      { timeout: 3000, signal },
    );
    const name = stdout.trim().split("\n")[0]?.trim();
    if (name) return name;
  } catch {
    // fall through
  }
  return FALLBACK;
}
