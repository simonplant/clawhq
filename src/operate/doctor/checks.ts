/**
 * Doctor diagnostic checks — 19 preventive checks covering all known failure modes.
 *
 * Each check is async and independent (runs in parallel via Promise.all).
 * Checks never throw — they return a result with pass/fail + message + fix.
 *
 * Categories:
 *   - Config validation (config-exists, config-valid, compose-exists)
 *   - Secrets & permissions (secrets-perms, creds-perms)
 *   - Docker runtime (docker-running, container-running, cap-drop, no-new-privileges, user-uid)
 *   - Agent health (identity-size, cron-syntax, env-vars, workspace-exists, gateway-reachable)
 *   - Infrastructure (firewall-active, disk-space)
 */

import { execFile } from "node:child_process";
import { access, constants, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { BOOTSTRAP_MAX_CHARS, CONTAINER_USER, DOCTOR_EXEC_TIMEOUT_MS, FILE_MODE_SECRET, GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";

import type { DoctorCheckName, DoctorCheckResult, DoctorSeverity } from "./types.js";

const execFileAsync = promisify(execFile);

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok(name: DoctorCheckName, message: string, severity: DoctorSeverity = "error"): DoctorCheckResult {
  return { name, passed: true, severity, message };
}

function fail(
  name: DoctorCheckName,
  severity: DoctorSeverity,
  message: string,
  fix?: string,
  fixable?: boolean,
): DoctorCheckResult {
  return { name, passed: false, severity, message, fix, fixable };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all 19 diagnostic checks. Every check runs even if earlier ones fail,
 * so the user gets a complete picture in one pass.
 */
export async function runChecks(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult[]> {
  return Promise.all([
    checkConfigExists(deployDir),
    checkConfigValid(deployDir),
    checkComposeExists(deployDir),
    checkSecretsPerms(deployDir),
    checkCredsPerms(deployDir),
    checkDockerRunning(signal),
    checkContainerRunning(deployDir, signal),
    checkCapDrop(deployDir, signal),
    checkNoNewPrivileges(deployDir, signal),
    checkUserUid(deployDir, signal),
    checkIdentitySize(deployDir),
    checkCronSyntax(deployDir),
    checkEnvVars(deployDir),
    checkFirewallActive(deployDir, signal),
    checkWorkspaceExists(deployDir),
    checkGatewayReachable(signal),
    checkDiskSpace(deployDir, signal),
    checkAirGapActive(deployDir, signal),
    checkToolAccessGrants(deployDir),
  ]);
}

// ── Individual Checks ───────────────────────────────────────────────────────

/** 1. openclaw.json exists. */
async function checkConfigExists(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "config-exists";
  const configPath = join(deployDir, "engine", "openclaw.json");
  try {
    await access(configPath, constants.R_OK);
    return ok(name, "Config file exists");
  } catch (e) {
    console.warn(`[doctor:config-exists] Failed to access config file:`, e);
    return fail(name, "error", "Config file not found at engine/openclaw.json", "Run: clawhq init --guided");
  }
}

/** 2. openclaw.json is valid JSON and passes landmine checks. */
async function checkConfigValid(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "config-valid";
  const configPath = join(deployDir, "engine", "openclaw.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;

    // Check critical landmine fields
    const issues: string[] = [];
    if (config["dangerouslyDisableDeviceAuth"] !== true) {
      issues.push("LM-01: dangerouslyDisableDeviceAuth must be true");
    }
    const origins = config["allowedOrigins"];
    if (!Array.isArray(origins) || origins.length === 0) {
      issues.push("LM-02: allowedOrigins is empty or missing");
    }
    const proxies = config["trustedProxies"];
    if (!Array.isArray(proxies) || proxies.length === 0) {
      issues.push("LM-03: trustedProxies is empty or missing");
    }
    const tools = config["tools"] as Record<string, unknown> | undefined;
    const exec = tools?.["exec"] as Record<string, unknown> | undefined;
    if (exec?.["host"] !== "gateway") {
      issues.push("LM-04: tools.exec.host must be \"gateway\"");
    }
    if (exec?.["security"] !== "full") {
      issues.push("LM-05: tools.exec.security must be \"full\"");
    }

    if (issues.length > 0) {
      return fail(
        name,
        "error",
        `Config has ${issues.length} landmine violation(s): ${issues[0]}${issues.length > 1 ? ` (+${issues.length - 1} more)` : ""}`,
        "Run: clawhq init --guided to regenerate config",
        true,
      );
    }
    return ok(name, "Config passes landmine checks");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      return fail(name, "error", "Config file not found — skipping validation", "Run: clawhq init --guided");
    }
    return fail(name, "error", `Config file has invalid JSON: ${msg}`, "Fix JSON syntax or re-run: clawhq init --guided");
  }
}

/** 3. docker-compose.yml exists. */
async function checkComposeExists(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "compose-exists";
  const composePath = join(deployDir, "engine", "docker-compose.yml");
  try {
    await access(composePath, constants.R_OK);
    return ok(name, "Compose file exists");
  } catch (e) {
    console.warn(`[doctor:compose-exists] Failed to access compose file:`, e);
    return fail(name, "error", "docker-compose.yml not found at engine/docker-compose.yml", "Run: clawhq init --guided");
  }
}

/** 4. .env file has mode 0600. */
async function checkSecretsPerms(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "secrets-perms";
  const envPath = join(deployDir, "engine", ".env");
  try {
    const info = await stat(envPath);
    const mode = info.mode & 0o777;
    if (mode !== FILE_MODE_SECRET) {
      return fail(
        name,
        "error",
        `.env permissions are ${mode.toString(8)} — must be 600`,
        `Run: chmod 600 ${envPath}`,
        true,
      );
    }
    return ok(name, "Secrets file has correct permissions (600)");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      return fail(name, "error", "Secrets file (.env) not found", "Run: clawhq init --guided");
    }
    return fail(name, "error", `Cannot read .env: ${msg}`);
  }
}

/** 5. credentials.json has mode 0600. */
async function checkCredsPerms(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "creds-perms";
  const credsPath = join(deployDir, "engine", "credentials.json");
  try {
    const info = await stat(credsPath);
    const mode = info.mode & 0o777;
    if (mode !== FILE_MODE_SECRET) {
      return fail(
        name,
        "warning",
        `credentials.json permissions are ${mode.toString(8)} — should be 600`,
        `Run: chmod 600 ${credsPath}`,
        true,
      );
    }
    return ok(name, "Credentials file has correct permissions (600)", "warning");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      return ok(name, "No credentials.json file (optional)", "info");
    }
    return fail(name, "warning", `Cannot read credentials.json: ${msg}`);
  }
}

/** 6. Docker daemon is running. */
async function checkDockerRunning(signal?: AbortSignal): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "docker-running";
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: DOCTOR_EXEC_TIMEOUT_MS,
      signal,
    });
    return ok(name, "Docker daemon is running");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("ENOENT")) {
      return fail(name, "error", "Docker is not installed", "Install Docker: https://docs.docker.com/get-docker/");
    }
    return fail(
      name,
      "error",
      "Docker daemon is not running",
      "Start Docker with: sudo systemctl start docker (Linux) or open Docker Desktop (macOS)",
    );
  }
}

/** 7. Agent container is running. */
async function checkContainerRunning(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "container-running";
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", join(deployDir, "engine", "docker-compose.yml"), "ps", "--format", "json"],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );

    if (!stdout.trim()) {
      return fail(name, "warning", "No containers running", "Run: clawhq up");
    }

    // docker compose ps --format json outputs one JSON object per line
    const lines = stdout.trim().split("\n");
    const running = lines.filter((line) => {
      try {
        const svc = JSON.parse(line) as { State?: string };
        return svc.State === "running";
      } catch (e) {
        console.warn(`[doctor:container-running] Failed to parse container JSON:`, e);
        return false;
      }
    });

    if (running.length === 0) {
      return fail(name, "warning", "Agent container is not running", "Run: clawhq up");
    }
    return ok(name, `Agent container is running (${running.length} service(s))`, "warning");
  } catch (e) {
    console.warn(`[doctor:container-running] Failed to check container status:`, e);
    return fail(name, "warning", "Cannot check container status — Docker may not be running", "Run: clawhq up");
  }
}

/** 8. Container has cap_drop: ALL (runtime Docker inspect). */
async function checkCapDrop(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "cap-drop";
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", join(deployDir, "engine", "docker-compose.yml"), "ps", "-q"],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );
    const containerId = stdout.trim().split("\n")[0];
    if (!containerId) {
      return fail(name, "info", "No container to inspect — skipping cap_drop check", "Run: clawhq up first");
    }

    const { stdout: inspectOut } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{json .HostConfig.CapDrop}}", containerId],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );

    const caps = JSON.parse(inspectOut.trim()) as string[] | null;
    const hasAll = caps?.some((c) => c.toLowerCase() === "all");
    if (!hasAll) {
      return fail(
        name,
        "error",
        "Container missing cap_drop: ALL — container escape vulnerability",
        "Add cap_drop: [ALL] to docker-compose.yml and redeploy",
        true,
      );
    }
    return ok(name, "Container has cap_drop: ALL");
  } catch (e) {
    console.warn(`[doctor:cap-drop] Failed to inspect container caps:`, e);
    return fail(name, "info", "Cannot inspect container caps — container may not be running");
  }
}

/** 9. Container has no-new-privileges security option. */
async function checkNoNewPrivileges(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "no-new-privileges";
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", join(deployDir, "engine", "docker-compose.yml"), "ps", "-q"],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );
    const containerId = stdout.trim().split("\n")[0];
    if (!containerId) {
      return fail(name, "info", "No container to inspect — skipping security_opt check");
    }

    const { stdout: inspectOut } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{json .HostConfig.SecurityOpt}}", containerId],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );

    const opts = JSON.parse(inspectOut.trim()) as string[] | null;
    const hasNoNewPriv = opts?.some(
      (o) => o === "no-new-privileges" || o === "no-new-privileges:true",
    );
    if (!hasNoNewPriv) {
      return fail(
        name,
        "error",
        "Container missing no-new-privileges security option",
        "Add security_opt: [no-new-privileges] to docker-compose.yml and redeploy",
        true,
      );
    }
    return ok(name, "Container has no-new-privileges");
  } catch (e) {
    console.warn(`[doctor:no-new-privileges] Failed to inspect container security opts:`, e);
    return fail(name, "info", "Cannot inspect container security opts — container may not be running");
  }
}

/** 10. Container runs as UID 1000. */
async function checkUserUid(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "user-uid";
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", join(deployDir, "engine", "docker-compose.yml"), "ps", "-q"],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );
    const containerId = stdout.trim().split("\n")[0];
    if (!containerId) {
      return fail(name, "info", "No container to inspect — skipping UID check");
    }

    const { stdout: inspectOut } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{.Config.User}}", containerId],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );

    const user = inspectOut.trim();
    const expectedUid = CONTAINER_USER.split(":")[0];
    if (user !== CONTAINER_USER && user !== expectedUid) {
      return fail(
        name,
        "error",
        `Container user is "${user || "root"}" — must be ${CONTAINER_USER} for volume permissions`,
        `Set user: "${CONTAINER_USER}" in docker-compose.yml and redeploy`,
        true,
      );
    }
    return ok(name, "Container runs as UID 1000");
  } catch (e) {
    console.warn(`[doctor:user-uid] Failed to inspect container user:`, e);
    return fail(name, "info", "Cannot inspect container user — container may not be running");
  }
}

/** 11. Identity files within bootstrapMaxChars. */
async function checkIdentitySize(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "identity-size";
  const identityDir = join(deployDir, "workspace", "identity");
  const DEFAULT_MAX_CHARS = BOOTSTRAP_MAX_CHARS;

  try {
    const entries = await readdir(identityDir);
    const mdFiles = entries.filter((f) => f.endsWith(".md"));

    let totalSize = 0;
    for (const file of mdFiles) {
      const content = await readFile(join(identityDir, file), "utf-8");
      totalSize += content.length;
    }

    // Try to read bootstrapMaxChars from config
    let maxChars = DEFAULT_MAX_CHARS;
    try {
      const configRaw = await readFile(join(deployDir, "engine", "openclaw.json"), "utf-8");
      const config = JSON.parse(configRaw) as { identity?: { bootstrapMaxChars?: number } };
      if (config.identity?.bootstrapMaxChars) {
        maxChars = config.identity.bootstrapMaxChars;
      }
    } catch (e) {
      console.warn(`[doctor:identity-size] Failed to read bootstrapMaxChars from config, using default:`, e);
    }

    if (totalSize > maxChars) {
      return fail(
        name,
        "error",
        `Identity files total ${totalSize} chars, exceeding limit of ${maxChars} — files will be silently truncated`,
        `Reduce identity file sizes or increase bootstrapMaxChars in openclaw.json`,
      );
    }
    return ok(name, `Identity files total ${totalSize} chars (limit: ${maxChars})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      return fail(name, "warning", "Identity directory not found at workspace/identity/", "Run: clawhq init --guided");
    }
    return fail(name, "warning", `Cannot read identity files: ${msg}`);
  }
}

/** 12. Cron jobs use valid stepping syntax. */
async function checkCronSyntax(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "cron-syntax";
  const cronPath = join(deployDir, "cron", "jobs.json");
  const INVALID_STEP = /^(\d+)\/(\d+)$/;

  try {
    const raw = await readFile(cronPath, "utf-8");
    const jobs = JSON.parse(raw) as Array<{ id: string; kind: string; expr?: string }>;

    const invalid: string[] = [];
    for (const job of jobs) {
      if (job.kind !== "cron" || !job.expr) continue;
      const fields = job.expr.trim().split(/\s+/);
      for (const field of fields) {
        if (INVALID_STEP.test(field)) {
          invalid.push(`${job.id} (field "${field}")`);
          break;
        }
      }
    }

    if (invalid.length > 0) {
      return fail(
        name,
        "error",
        `Invalid cron stepping in: ${invalid.join(", ")} — jobs will silently not run`,
        'Use "start-end/step" instead of bare "N/step" (e.g. "3-58/15" not "5/15")',
      );
    }
    return ok(name, `All ${jobs.length} cron job(s) have valid syntax`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      return ok(name, "No cron jobs configured (optional)", "info");
    }
    return fail(name, "warning", `Cannot read cron jobs: ${msg}`);
  }
}

/** 13. Required env vars referenced in compose are present in .env. */
async function checkEnvVars(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "env-vars";
  const envPath = join(deployDir, "engine", ".env");
  const composePath = join(deployDir, "engine", "docker-compose.yml");

  try {
    // Read .env
    let envContent: string;
    try {
      envContent = await readFile(envPath, "utf-8");
    } catch (e) {
      console.warn(`[doctor:env-vars] Failed to read .env file:`, e);
      return fail(name, "error", ".env file not found", "Run: clawhq init --guided");
    }

    const envKeys = new Set<string>();
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) envKeys.add(trimmed.slice(0, eqIdx));
    }

    // Read compose and find ${VAR} references
    let composeContent: string;
    try {
      composeContent = await readFile(composePath, "utf-8");
    } catch (e) {
      console.warn(`[doctor:env-vars] Failed to read docker-compose.yml:`, e);
      return fail(name, "warning", "docker-compose.yml not found — cannot check env var references");
    }

    const refPattern = /\$\{([A-Z_][A-Z0-9_]*?)(?::.*?)?\}/g;
    const referenced = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = refPattern.exec(composeContent)) !== null) {
      referenced.add(match[1]);
    }

    const missing = Array.from(referenced).filter((v) => !envKeys.has(v));
    if (missing.length > 0) {
      return fail(
        name,
        "error",
        `Missing .env variables: ${missing.join(", ")} — integrations will silently fail`,
        `Add missing variables to .env: ${missing.join(", ")}`,
      );
    }
    return ok(name, `All ${referenced.size} referenced env variable(s) are set`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(name, "warning", `Cannot check env vars: ${msg}`);
  }
}

/** 14. CLAWHQ_FWD iptables chain exists and rules match expected. */
async function checkFirewallActive(deployDir: string, signal?: AbortSignal): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "firewall-active";
  try {
    // First check: does the chain exist?
    const { stdout } = await execFileAsync("sudo", ["iptables", "-L", "CLAWHQ_FWD", "-n", "--line-numbers"], {
      timeout: DOCTOR_EXEC_TIMEOUT_MS,
      signal,
    });

    // Second check: does it have the expected rules?
    // Count non-header lines to verify rules are populated
    const ruleLines = stdout.split("\n").filter(
      (l) => l.trim() && !l.startsWith("Chain ") && !l.startsWith("num "),
    );

    if (ruleLines.length === 0) {
      return fail(
        name,
        "warning",
        "Egress firewall chain CLAWHQ_FWD exists but has no rules — egress is unfiltered",
        "Run: clawhq up (firewall rules are applied during deploy)",
      );
    }

    // Verify DROP rule is present (last line of defense)
    const hasDropRule = ruleLines.some((l) => l.includes("DROP"));
    if (!hasDropRule) {
      return fail(
        name,
        "warning",
        "Egress firewall chain CLAWHQ_FWD is missing DROP rule — egress may be unfiltered",
        "Run: clawhq up (firewall is reapplied during deploy)",
      );
    }

    return ok(name, `Egress firewall chain CLAWHQ_FWD is active (${ruleLines.length} rules)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No chain") || msg.includes("doesn't exist")) {
      return fail(
        name,
        "warning",
        "Egress firewall chain CLAWHQ_FWD not found — network egress is unfiltered",
        "Run: clawhq up (firewall is applied during deploy)",
      );
    }
    // Permission denied or iptables not found — not an error for the user
    return fail(
      name,
      "info",
      "Cannot check firewall (requires sudo/iptables)",
      "Run with sudo to check firewall status",
    );
  }
}

/** 15. Workspace directory structure is intact. */
async function checkWorkspaceExists(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "workspace-exists";
  const requiredDirs = ["identity", "tools", "skills", "memory"];
  const workspaceDir = join(deployDir, "workspace");

  try {
    await access(workspaceDir, constants.R_OK);
  } catch (e) {
    console.warn(`[doctor:workspace-exists] Failed to access workspace directory:`, e);
    return fail(name, "error", "Workspace directory not found", "Run: clawhq init --guided");
  }

  const missing: string[] = [];
  for (const dir of requiredDirs) {
    try {
      await access(join(workspaceDir, dir), constants.R_OK);
    } catch (e) {
      console.warn(`[doctor:workspace-exists] Failed to access workspace/${dir}:`, e);
      missing.push(dir);
    }
  }

  if (missing.length > 0) {
    return fail(
      name,
      "warning",
      `Missing workspace directories: ${missing.join(", ")}`,
      "Run: clawhq init --guided to regenerate workspace structure",
    );
  }
  return ok(name, "Workspace directory structure is intact");
}

/** 16. Gateway WebSocket responds on localhost. */
async function checkGatewayReachable(signal?: AbortSignal): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "gateway-reachable";
  try {
    // Use curl to check if gateway port responds
    await execFileAsync(
      "curl",
      ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", `http://localhost:${GATEWAY_DEFAULT_PORT}`],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );
    return ok(name, `Gateway is reachable on localhost:${GATEWAY_DEFAULT_PORT}`);
  } catch (e) {
    console.warn(`[doctor:gateway-reachable] Failed to reach gateway:`, e);
    return fail(
      name,
      "info",
      `Gateway not reachable on localhost:${GATEWAY_DEFAULT_PORT} — agent may not be running`,
      "Run: clawhq up",
    );
  }
}

/** 17. Sufficient disk space in deployment directory. */
async function checkDiskSpace(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "disk-space";
  const MIN_FREE_MB = 500;

  try {
    const { stdout } = await execFileAsync(
      "df",
      ["--output=avail", "-BM", deployDir],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );

    const lines = stdout.trim().split("\n");
    if (lines.length < 2) {
      return ok(name, "Disk space check inconclusive", "info");
    }

    const availStr = lines[1].trim().replace("M", "");
    const availMb = parseInt(availStr, 10);
    if (isNaN(availMb)) {
      return ok(name, "Disk space check inconclusive", "info");
    }

    if (availMb < MIN_FREE_MB) {
      return fail(
        name,
        "warning",
        `Only ${availMb}MB free — recommend at least ${MIN_FREE_MB}MB`,
        "Free up disk space in the deployment directory",
      );
    }
    return ok(name, `${availMb}MB free disk space`);
  } catch (e) {
    console.warn(`[doctor:disk-space] Failed to check disk space:`, e);
    return ok(name, "Disk space check skipped (df unavailable)", "info");
  }
}

/** 19. Tool access grants present (OpenClaw v0.8.7+ defaults to admin-only). */
async function checkToolAccessGrants(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "tool-access-grants";
  const configPath = join(deployDir, "engine", "openclaw.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const tools = config["tools"] as Record<string, unknown> | undefined;
    const accessGrants = tools?.["accessGrants"] as unknown[] | undefined;

    if (!Array.isArray(accessGrants) || accessGrants.length === 0) {
      return fail(
        name,
        "warning",
        "Missing tools.accessGrants — tools are invisible to non-admin users on OpenClaw v0.8.7+",
        'Add tools.accessGrants: [{"type":"user","value":"*"}] to openclaw.json or re-run: clawhq init --guided',
        true,
      );
    }
    return ok(name, `Tool access grants configured (${accessGrants.length} grant(s))`, "warning");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      return fail(name, "warning", "Config file not found — cannot check tool access grants", "Run: clawhq init --guided");
    }
    return fail(name, "warning", `Cannot check tool access grants: ${msg}`);
  }
}

/** 18. Air-gap mode: verify firewall blocks all egress (no HTTPS allowlist rules). */
async function checkAirGapActive(deployDir: string, signal?: AbortSignal): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "air-gap-active";
  const allowlistPath = join(deployDir, "ops", "firewall", "allowlist.yaml");

  try {
    // Check if allowlist file exists — if missing, air-gap is not configured
    try {
      await access(allowlistPath, constants.R_OK);
    } catch {
      // No allowlist file means air-gap wasn't explicitly configured
      return ok(name, "Air-gap check skipped (no allowlist file)", "info");
    }

    // Read allowlist — empty means air-gap mode
    const raw = await readFile(allowlistPath, "utf-8");
    const trimmed = raw.trim();
    const isEmptyAllowlist = !trimmed || trimmed === "[]" || trimmed === "domains: []";

    if (!isEmptyAllowlist) {
      // Not in air-gap mode — that's fine, just report status
      return ok(name, "Not in air-gap mode (allowlist has entries)", "info");
    }

    // Air-gap config is set — verify firewall matches
    try {
      const { stdout } = await execFileAsync("sudo", ["iptables", "-L", "CLAWHQ_FWD", "-n"], {
        timeout: DOCTOR_EXEC_TIMEOUT_MS,
        signal,
      });

      // In air-gap mode there should be NO ACCEPT rules for port 443/53
      const hasHttpsAccept = stdout.split("\n").some(
        (l) => l.includes("ACCEPT") && (l.includes("dpt:443") || l.includes("dpt:53")),
      );

      if (hasHttpsAccept) {
        return fail(
          name,
          "warning",
          "Air-gap config set but firewall has HTTPS/DNS ACCEPT rules — egress not fully blocked",
          "Run: clawhq up --air-gap (reapplies firewall in air-gap mode)",
        );
      }

      return ok(name, "Air-gap mode active: config and firewall both blocking all egress");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("No chain") || msg.includes("doesn't exist")) {
        return fail(
          name,
          "warning",
          "Air-gap config set but firewall chain not found — egress is unfiltered",
          "Run: clawhq up --air-gap",
        );
      }
      return ok(name, "Air-gap firewall check skipped (requires sudo/iptables)", "info");
    }
  } catch (err) {
    console.warn("[doctor:air-gap-active] Failed to check air-gap status:", err);
    return ok(name, "Air-gap check inconclusive", "info");
  }
}
