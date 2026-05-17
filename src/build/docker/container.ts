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

import { openclawContainerName, openclawServiceName } from "./container-naming.js";

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

/**
 * Probe docker for any running container whose compose-service label is
 * `openclaw` (legacy literal) or starts with `openclaw-` (instance-scoped).
 * Returns the first match — sufficient for the single-agent-on-host case,
 * which is the only situation this fallback exists to handle.
 *
 * When multiple openclaw containers run on one host the caller must pass
 * a `deployDir` so we go through the deterministic-naming path instead.
 */
async function dockerPsByServiceLabel(signal?: AbortSignal): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "ps",
        "--filter",
        "label=com.docker.compose.service",
        "--format",
        "{{.Names}}\t{{.Label \"com.docker.compose.service\"}}",
      ],
      { timeout: 3000, signal },
    );
    for (const line of stdout.trim().split("\n")) {
      const [name, label] = line.split("\t");
      if (!name || !label) continue;
      if (label === "openclaw" || label.startsWith("openclaw-")) {
        return name;
      }
    }
    return undefined;
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

/**
 * Resolve the docker-compose service key for the openclaw service in a
 * given deployment.
 *
 * Precedence:
 *   1. Parse the generated `docker-compose.yml` and pick the first service
 *      whose key is `openclaw` or starts with `openclaw-`. The on-disk
 *      file is source of truth — this handles legacy deployments (still
 *      literally `openclaw`) and new instance-scoped keys
 *      (`openclaw-<shortId>`) uniformly, with no migration step required.
 *   2. Derive deterministically from `instanceId` in `clawhq.yaml`
 *      (`openclaw-<shortId>`).
 *   3. Last-resort: `"openclaw"` — preserves the pre-instance-scope literal
 *      for very early deployments or empty scaffolds.
 *
 * Sync by design — only reads local files, never probes docker. Call this
 * before exec'ing `docker compose -f <file> exec -T <service>` so the
 * service key in the command matches the key in the file.
 */
export function resolveOpenclawServiceName(
  options: { readonly deployDir: string },
): string {
  // 1. Source of truth: the on-disk compose.yml
  const composePath = join(options.deployDir, "engine", "docker-compose.yml");
  if (existsSync(composePath)) {
    try {
      const parsed = parseYaml(readFileSync(composePath, "utf-8")) as {
        services?: Record<string, unknown>;
      } | null;
      const services = parsed?.services ?? {};
      const key = Object.keys(services).find(
        (k) => k === "openclaw" || k.startsWith("openclaw-"),
      );
      if (key) return key;
    } catch {
      // Malformed yaml is non-fatal — fall through to derivation.
    }
  }

  // 2. Derive from registered instanceId
  const instanceId = readInstanceIdFromDeploy(options.deployDir);
  if (instanceId) return openclawServiceName(instanceId);

  // 3. Last-resort legacy literal
  return "openclaw";
}
