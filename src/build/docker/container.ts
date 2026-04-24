/**
 * Resolve the running openclaw container name.
 *
 * Precedence:
 *   1. Caller supplies `deployDir` → read `clawhq.yaml`, pull `instanceId`,
 *      return the deterministic `openclaw-<shortId>` name. No docker call
 *      needed; callers use the name with `docker exec` / `docker inspect`
 *      which will surface a clear error if the container isn't up.
 *   2. Caller supplies no `deployDir` (legacy call sites) → probe docker
 *      by compose service label. Works when a single openclaw container
 *      is running on this host.
 *   3. Nothing found → return `undefined`. The old singleton fallback
 *     (`engine-openclaw-1`) was a phantom-multi-tenancy landmine and has
 *      been removed; callers must handle the undefined case explicitly.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { parse as parseYaml } from "yaml";

import { openclawContainerName } from "./container-naming.js";

const execFileAsync = promisify(execFile);

export interface ResolveContainerOptions {
  /** Preferred: deployment directory. When given, the name is derived from the registered instanceId. */
  readonly deployDir?: string;
  readonly signal?: AbortSignal;
}

/**
 * Read `instanceId` from a deployment's clawhq.yaml. Returns undefined if
 * the file is missing, malformed, or has no `instanceId` field (pre-187
 * installs that haven't been re-applied yet).
 */
function readInstanceIdFromDeploy(deployDir: string): string | undefined {
  const path = join(deployDir, "clawhq.yaml");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = parseYaml(readFileSync(path, "utf-8")) as Record<string, unknown> | null;
    const id = parsed?.["instanceId"];
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

async function dockerPsByServiceLabel(signal?: AbortSignal): Promise<string | undefined> {
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
    return name && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Preferred API: pass a `deployDir` (or `signal` in an options object).
 * Legacy callers passing `(signal)` directly still work; that form goes
 * through the label-probe path only.
 */
export async function resolveOpenclawContainer(
  optionsOrSignal?: ResolveContainerOptions | AbortSignal,
): Promise<string | undefined> {
  const options: ResolveContainerOptions =
    optionsOrSignal && typeof (optionsOrSignal as AbortSignal).aborted === "boolean"
      ? { signal: optionsOrSignal as AbortSignal }
      : ((optionsOrSignal as ResolveContainerOptions | undefined) ?? {});

  // 1. Deterministic via registry-backed instanceId in clawhq.yaml
  if (options.deployDir) {
    const instanceId = readInstanceIdFromDeploy(options.deployDir);
    if (instanceId) return openclawContainerName(instanceId);
  }

  // 2. Probe by compose service label (single-container-on-host path)
  const byLabel = await dockerPsByServiceLabel(options.signal);
  if (byLabel) return byLabel;

  // 3. Unknown — fallback removed (was a phantom-multi-tenancy landmine).
  return undefined;
}

/**
 * Like `resolveOpenclawContainer`, but throws if the container can't be
 * resolved. Use this at call sites that can't proceed without a name
 * (most `docker exec`-based tool code). The error is actionable — it
 * tells the user exactly what to run.
 */
export async function requireOpenclawContainer(
  optionsOrSignal?: ResolveContainerOptions | AbortSignal,
): Promise<string> {
  const name = await resolveOpenclawContainer(optionsOrSignal);
  if (!name) {
    throw new Error(
      "[docker] no running openclaw container found — is the agent up? Try `clawhq up`.",
    );
  }
  return name;
}
