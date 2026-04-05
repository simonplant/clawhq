/**
 * Doctor diagnostic checks — 24 preventive checks covering all known failure modes.
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
 *   - Upgrade (migration-state, tool-access-grants, underscore-tool-methods)
 */

import { execFile } from "node:child_process";
import { access, constants, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { BOOTSTRAP_MAX_CHARS, CONTAINER_USER, CRED_PROXY_PORT, DOCTOR_EXEC_TIMEOUT_MS, FILE_MODE_SECRET, GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";

import { collectIntegrationDomains, IPSET_NAME, IPSET_REFRESH_INTERVAL_MS, loadAllowlist, loadIpsetMeta } from "../../build/launcher/firewall.js";
import { INTEGRATION_REGISTRY } from "../../evolve/integrate/registry.js";
import { isTimerActive } from "../automation/install.js";
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

// ── Version Detection ───────────────────────────────────────────────────────

/**
 * Compare two semver-style version strings.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Detect the running OpenClaw version.
 *
 * Strategy:
 * 1. Parse the Docker image tag from docker-compose.yml (works offline)
 * 2. Fall back to `docker exec` to read package.json (requires running container)
 *
 * Returns a semver string (e.g. "0.8.7") or null if version is unknown.
 */
export async function detectOpenClawVersion(
  deployDir: string,
  signal?: AbortSignal,
): Promise<string | null> {
  // Strategy 1: Parse image tag from docker-compose.yml
  try {
    const composePath = join(deployDir, "engine", "docker-compose.yml");
    const compose = await readFile(composePath, "utf-8");
    // Match image: openclaw:vX.Y.Z, openclaw:X.Y.Z, or openclaw/openclaw:vX.Y.Z
    const imageMatch = compose.match(/image:\s*[\w./]*openclaw[^:\s]*:v?(\d+\.\d+\.\d+)/i);
    if (imageMatch?.[1]) {
      return imageMatch[1];
    }
  } catch {
    // Compose file not readable — try fallback
  }

  // Strategy 2: docker exec to read package.json version from running container
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "compose", "-f", join(deployDir, "engine", "docker-compose.yml"),
        "exec", "-T", "openclaw", "cat", "/app/package.json",
      ],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );
    const pkg = JSON.parse(stdout) as { version?: string };
    if (pkg.version) {
      return pkg.version;
    }
  } catch {
    // Container not running or package.json not at expected path
  }

  return null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all 21 diagnostic checks. Every check runs even if earlier ones fail,
 * so the user gets a complete picture in one pass.
 */
export async function runChecks(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult[]> {
  // Detect OpenClaw version first — used by upgrade-related checks
  const version = await detectOpenClawVersion(deployDir, signal);

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
    checkIpsetEgressCurrent(deployDir, signal),
    checkToolAccessGrants(deployDir, version),
    checkMigrationState(deployDir, signal),
    checkUnderscoreToolMethods(deployDir, version),
    check1PasswordSetup(deployDir, signal),
    checkSanitizeAvailable(deployDir),
    checkOpsAutoUpdateActive(deployDir, signal),
    checkOpsBackupRecent(deployDir, signal),
    checkOpsSecurityMonitor(deployDir, signal),
    checkCredProxyHealthy(deployDir, signal),
    checkEgressDomainsCoverage(deployDir),
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
  } catch {
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

    // Check critical landmine fields (both legacy top-level and new nested locations)
    const issues: string[] = [];
    const gw = config["gateway"] as Record<string, unknown> | undefined;
    const cui = (gw?.["controlUi"] ?? {}) as Record<string, unknown>;
    if (config["dangerouslyDisableDeviceAuth"] !== true && cui["dangerouslyDisableDeviceAuth"] !== true) {
      issues.push("LM-01: dangerouslyDisableDeviceAuth must be true");
    }
    const origins = config["allowedOrigins"] ?? cui["allowedOrigins"];
    if (!Array.isArray(origins) || origins.length === 0) {
      issues.push("LM-02: allowedOrigins is empty or missing");
    }
    const proxies = config["trustedProxies"] ?? gw?.["trustedProxies"];
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
  } catch {
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
      } catch {
        return false;
      }
    });

    if (running.length === 0) {
      return fail(name, "warning", "Agent container is not running", "Run: clawhq up");
    }
    return ok(name, `Agent container is running (${running.length} service(s))`, "warning");
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
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
    } catch {
      // Use default bootstrapMaxChars
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

/** Valid ranges for each cron field position. */
const CRON_FIELD_RANGES: ReadonlyArray<{ name: string; min: number; max: number }> = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
];

/**
 * Validate a single cron field part against its allowed range.
 * Returns an error message or null if valid.
 */
function validateCronFieldPart(
  part: string,
  range: { name: string; min: number; max: number },
): string | null {
  if (part === "*") return null;

  const wildcardStep = part.match(/^\*\/(\d+)$/);
  if (wildcardStep) {
    const step = parseInt(wildcardStep[1]!, 10);
    if (step === 0) return `${range.name}: step value cannot be 0`;
    return null;
  }

  const rangeMatch = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1]!, 10);
    const hi = parseInt(rangeMatch[2]!, 10);
    if (lo < range.min || lo > range.max)
      return `${range.name}: value ${lo} out of range ${range.min}-${range.max}`;
    if (hi < range.min || hi > range.max)
      return `${range.name}: value ${hi} out of range ${range.min}-${range.max}`;
    if (rangeMatch[3] !== undefined) {
      const step = parseInt(rangeMatch[3], 10);
      if (step === 0) return `${range.name}: step value cannot be 0`;
    }
    return null;
  }

  if (/^\d+$/.test(part)) {
    const num = parseInt(part, 10);
    if (num < range.min || num > range.max)
      return `${range.name}: value ${num} out of range ${range.min}-${range.max}`;
    return null;
  }

  return `${range.name}: invalid syntax "${part}"`;
}

/**
 * Validate a cron expression for correct field count and value ranges.
 * Returns an array of error strings (empty if valid).
 */
function validateCronExpr(expr: string): string[] {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return [`expected 5 fields, got ${fields.length}`];
  }
  const errors: string[] = [];
  for (let i = 0; i < 5; i++) {
    const field = fields[i]!;
    const range = CRON_FIELD_RANGES[i]!;
    for (const part of field.split(",")) {
      const err = validateCronFieldPart(part, range);
      if (err) errors.push(err);
    }
  }
  return errors;
}

/** 12. Cron jobs use valid syntax — field count, value ranges, and stepping. */
async function checkCronSyntax(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "cron-syntax";
  const cronPath = join(deployDir, "cron", "jobs.json");

  try {
    const raw = await readFile(cronPath, "utf-8");
    const jobs = JSON.parse(raw) as Array<{ id: string; kind: string; expr?: string }>;

    const invalid: string[] = [];
    for (const job of jobs) {
      if (job.kind !== "cron" || !job.expr) continue;
      const errors = validateCronExpr(job.expr);
      if (errors.length > 0) {
        invalid.push(`${job.id}: ${errors.join(", ")}`);
      }
    }

    if (invalid.length > 0) {
      return fail(
        name,
        "error",
        `Invalid cron expression(s): ${invalid.join("; ")} — jobs will silently not run`,
        "Fix cron expressions: use 5 fields with valid ranges (minute 0-59, hour 0-23, day 1-31, month 1-12, weekday 0-7)",
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
    } catch {
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
    } catch {
      return fail(name, "warning", "docker-compose.yml not found — cannot check env var references");
    }

    // Find ${VAR} references — ${VAR:-} means optional (has default fallback)
    const requiredPattern = /\$\{([A-Z_][A-Z0-9_]*?)\}/g;
    const optionalPattern = /\$\{([A-Z_][A-Z0-9_]*?):-[^}]*\}/g;

    const required = new Set<string>();
    const optional = new Set<string>();

    let match: RegExpExecArray | null;
    // Find optional vars first (they have :- defaults)
    while ((match = optionalPattern.exec(composeContent)) !== null) {
      optional.add(match[1]);
    }
    // Find all referenced vars
    while ((match = requiredPattern.exec(composeContent)) !== null) {
      if (!optional.has(match[1])) {
        required.add(match[1]);
      }
    }

    const missing = Array.from(required).filter((v) => !envKeys.has(v));
    const missingOptional = Array.from(optional).filter((v) => !envKeys.has(v));

    if (missing.length > 0) {
      return fail(
        name,
        "error",
        `Missing required .env variables: ${missing.join(", ")}`,
        `Add missing variables to .env: ${missing.join(", ")}`,
      );
    }
    if (missingOptional.length > 0) {
      return ok(name, `All required env vars set. Optional not configured: ${missingOptional.join(", ")}`);
    }
    return ok(name, `All ${required.size + optional.size} referenced env variable(s) are set`);
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
  } catch {
    return fail(name, "error", "Workspace directory not found", "Run: clawhq init --guided");
  }

  const missing: string[] = [];
  for (const dir of requiredDirs) {
    try {
      await access(join(workspaceDir, dir), constants.R_OK);
    } catch {
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
  } catch {
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
  } catch {
    return ok(name, "Disk space check skipped (df unavailable)", "info");
  }
}

/** 19. Tool access grants present (OpenClaw v0.8.7+ defaults to admin-only). */
async function checkToolAccessGrants(deployDir: string, version: string | null): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "tool-access-grants";

  // Version-gate: only relevant for v0.8.7+
  if (version && compareVersions(version, "0.8.7") < 0) {
    return ok(name, `Tool access grants check skipped (OpenClaw ${version} < 0.8.7)`, "info");
  }

  const configPath = join(deployDir, "engine", "openclaw.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const tools = config["tools"] as Record<string, unknown> | undefined;
    const accessGrants = tools?.["accessGrants"] as unknown[] | undefined;

    if (!Array.isArray(accessGrants) || accessGrants.length === 0) {
      const versionNote = version
        ? ""
        : " (Note: OpenClaw version unknown — running check unconditionally)";
      return fail(
        name,
        "warning",
        `Missing tools.accessGrants — tools are invisible to non-admin users on OpenClaw v0.8.7+${versionNote}`,
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

/** 20. Database migrations completed successfully after upgrade. */
async function checkMigrationState(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "migration-state";

  try {
    // Get container ID
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", join(deployDir, "engine", "docker-compose.yml"), "ps", "-q"],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );
    const containerId = stdout.trim().split("\n")[0];
    if (!containerId) {
      return ok(name, "Migration check skipped — no container running", "info");
    }

    // Check recent container logs for migration failure patterns
    // docker logs sends stdout and stderr separately — check both
    const { stdout: logs, stderr: errLogs } = await execFileAsync(
      "docker",
      ["logs", "--tail", "200", containerId],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );
    const allLogs = logs + "\n" + errLogs;

    const migrationFailurePatterns = [
      /migration.*fail/i,
      /migration.*error/i,
      /database.*migration.*incomplete/i,
      /schema.*migration.*failed/i,
      /typeorm.*migration.*error/i,
      /prisma.*migration.*error/i,
      /knex.*migration.*error/i,
      /sequelize.*migration.*error/i,
    ];

    const failedLines: string[] = [];
    for (const line of allLogs.split("\n")) {
      for (const pattern of migrationFailurePatterns) {
        if (pattern.test(line)) {
          failedLines.push(line.trim());
          break;
        }
      }
    }

    if (failedLines.length > 0) {
      return fail(
        name,
        "error",
        `Database migration failure detected in container logs: ${failedLines[0]}${failedLines.length > 1 ? ` (+${failedLines.length - 1} more)` : ""}`,
        "Check database connectivity and re-run migrations. Restart with: clawhq restart",
      );
    }

    return ok(name, "No migration failures detected in container logs");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // stderr from docker logs goes to stderr, not stdout — handle both
    if (msg.includes("No such container") || msg.includes("ENOENT")) {
      return ok(name, "Migration check skipped — container not available", "info");
    }
    return ok(name, "Migration check skipped — cannot read container logs", "info");
  }
}

/** 21. Detect tools with underscore-prefixed methods (hidden on OpenClaw v0.8.10+). */
async function checkUnderscoreToolMethods(
  deployDir: string,
  version: string | null,
): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "underscore-tool-methods";

  // Version-gate: only relevant for v0.8.10+
  if (version && compareVersions(version, "0.8.10") < 0) {
    return ok(name, `Underscore tool methods check skipped (OpenClaw ${version} < 0.8.10)`, "info");
  }

  const toolsDir = join(deployDir, "workspace", "tools");

  try {
    const entries = await readdir(toolsDir);
    const toolFiles = entries.filter(
      (f) => f.endsWith(".sh") || f.endsWith(".py") || f.endsWith(".ts") || f.endsWith(".js"),
    );

    if (toolFiles.length === 0) {
      return ok(name, "No tool scripts found", "info");
    }

    // Patterns that match underscore-prefixed function/method declarations
    const underscorePatterns = [
      /^(?:function\s+|export\s+(?:async\s+)?function\s+)(_\w+)/m,  // bash/JS/TS function _foo
      /^def\s+(_\w+)\s*\(/m,                                         // python def _foo(
      /^\s*(?:async\s+)?(_\w+)\s*\(\)\s*\{/m,                       // bash _foo() {
    ];

    const toolsWithUnderscore: Array<{ file: string; methods: string[] }> = [];

    for (const file of toolFiles) {
      try {
        const content = await readFile(join(toolsDir, file), "utf-8");
        const methods: string[] = [];

        for (const line of content.split("\n")) {
          for (const pattern of underscorePatterns) {
            const match = pattern.exec(line);
            if (match?.[1]) {
              methods.push(match[1]);
            }
          }
        }

        if (methods.length > 0) {
          toolsWithUnderscore.push({ file, methods });
        }
      } catch {
        // Skip unreadable files
      }
    }

    if (toolsWithUnderscore.length > 0) {
      const details = toolsWithUnderscore
        .map((t) => `${t.file}: ${t.methods.join(", ")}`)
        .join("; ");
      const versionNote = version
        ? ""
        : " (Note: OpenClaw version unknown — running check unconditionally)";
      return fail(
        name,
        "warning",
        `Found underscore-prefixed methods no longer LLM-visible on v0.8.10+: ${details}${versionNote}`,
        "Rename underscore-prefixed methods to remove the leading underscore, or remove them if no longer needed",
      );
    }

    return ok(name, `All ${toolFiles.length} tool script(s) have no underscore-prefixed methods`, "warning");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      return ok(name, "Tools directory not found — skipping underscore method check", "info");
    }
    return fail(name, "warning", `Cannot check tool methods: ${msg}`);
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
  } catch {
    return ok(name, "Air-gap check inconclusive", "info");
  }
}

// ── 19. Ipset Egress Current ─────────────────────────────────────────────────

/** Verify the egress ipset exists, is populated, and was recently refreshed. */
async function checkIpsetEgressCurrent(deployDir: string, signal?: AbortSignal): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "ipset-egress-current";

  try {
    // Check if ipset metadata exists (written during applyFirewall)
    const meta = await loadIpsetMeta(deployDir);
    if (!meta) {
      return ok(name, "Ipset check skipped (no ipset metadata — firewall may use air-gap or not be applied)", "info");
    }

    // Check if the ipset exists in the kernel
    try {
      await execFileAsync("sudo", ["ipset", "list", IPSET_NAME, "-terse"], {
        timeout: DOCTOR_EXEC_TIMEOUT_MS,
        signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("does not exist") || msg.includes("The set with the given name does not exist")) {
        return fail(
          name,
          "warning",
          `Egress ipset '${IPSET_NAME}' not found — domain-based firewall is inactive`,
          "Run: clawhq up (ipset is created during deploy)",
        );
      }
      // Permission denied or ipset not installed
      return ok(name, "Ipset check skipped (requires sudo/ipset)", "info");
    }

    // Check staleness: lastRefreshed should be within 2x the refresh interval
    const lastRefreshed = new Date(meta.lastRefreshed).getTime();
    const staleThresholdMs = (meta.refreshIntervalMs || IPSET_REFRESH_INTERVAL_MS) * 2;
    const ageMs = Date.now() - lastRefreshed;

    if (ageMs > staleThresholdMs) {
      const ageMinutes = Math.floor(ageMs / 60_000);
      return fail(
        name,
        "warning",
        `Egress ipset is stale — last DNS refresh was ${ageMinutes} minutes ago (threshold: ${Math.floor(staleThresholdMs / 60_000)} min)`,
        "Run: clawhq up (restarts the ipset refresh timer)",
      );
    }

    // Check that resolved IPs exist
    const totalIps = (meta.resolvedV4 || 0) + (meta.resolvedV6 || 0);
    if (totalIps === 0 && meta.domains.length > 0) {
      return fail(
        name,
        "warning",
        `Egress ipset has 0 resolved IPs for ${meta.domains.length} domain(s) — DNS resolution may have failed`,
        "Check DNS connectivity and run: clawhq up",
      );
    }

    // Verify allowlist domains match current allowlist
    const allowlistPath = join(deployDir, "ops", "firewall", "allowlist.yaml");
    try {
      const raw = await readFile(allowlistPath, "utf-8");
      const { parse: yamlParse } = await import("yaml");
      const parsed: unknown = yamlParse(raw);
      if (Array.isArray(parsed)) {
        const currentDomains = parsed
          .filter((item): item is { domain: string } =>
            typeof item === "object" && item !== null && "domain" in item && typeof item.domain === "string")
          .map((item) => item.domain)
          .sort();
        const metaDomains = [...meta.domains].sort();

        if (JSON.stringify(currentDomains) !== JSON.stringify(metaDomains)) {
          return fail(
            name,
            "warning",
            "Egress ipset domains don't match current allowlist — allowlist may have changed since last deploy",
            "Run: clawhq up (recreates ipset from current allowlist)",
          );
        }
      }
    } catch {
      // Can't read allowlist — skip domain comparison
    }

    const ageMinutes = Math.floor(ageMs / 60_000);
    return ok(
      name,
      `Egress ipset current: ${totalIps} IPs from ${meta.domains.length} domain(s), refreshed ${ageMinutes}m ago`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(name, "warning", `Ipset check failed: ${msg}`);
  }
}

// ── 22. 1Password Setup ──────────────────────────────────────────────────────

/** Check 1Password service account token is configured when the integration is active. */
async function check1PasswordSetup(deployDir: string, signal?: AbortSignal): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "onepassword-setup";

  try {
    // Check if 1Password integration is configured by looking for the token in .env
    // or Docker secrets directory
    const envPath = join(deployDir, "engine", ".env");
    const secretsDir = join(deployDir, "engine", "secrets");
    const secretTokenPath = join(secretsDir, "op_service_account_token");

    let hasEnvToken = false;
    let hasSecretToken = false;
    let token = "";

    // Check Docker secret file first (preferred)
    try {
      const secretContent = await readFile(secretTokenPath, "utf-8");
      token = secretContent.trim();
      hasSecretToken = !!token;
    } catch {
      // No Docker secret file
    }

    // Fall back to .env token
    if (!hasSecretToken) {
      try {
        const envContent = await readFile(envPath, "utf-8");
        const tokenLine = envContent.split("\n").find((l) => l.startsWith("OP_SERVICE_ACCOUNT_TOKEN="));
        if (tokenLine) {
          token = tokenLine.split("=").slice(1).join("=").trim();
          hasEnvToken = !!token;
        }
      } catch {
        // No .env file
      }
    }

    if (!hasSecretToken && !hasEnvToken) {
      // 1Password not configured — that's fine
      return ok(name, "1Password not configured", "info");
    }

    // Token is set — validate format
    if (!token.startsWith("ops_")) {
      return fail(
        name,
        "warning",
        "OP_SERVICE_ACCOUNT_TOKEN has invalid format (expected ops_... prefix)",
        "Regenerate service account token at https://my.1password.com/developer-tools/infrastructure-secrets/serviceaccount",
      );
    }

    // Warn if token is in .env instead of Docker secret
    if (hasEnvToken && !hasSecretToken) {
      return fail(
        name,
        "warning",
        "1Password token found in .env — should use Docker secret for better security",
        `Move token to ${secretTokenPath} and remove from .env. Run: clawhq build to regenerate compose with secrets`,
      );
    }

    // Check op CLI is available in the container
    try {
      await execFileAsync(
        "docker",
        [
          "compose", "-f", join(deployDir, "engine", "docker-compose.yml"),
          "exec", "-T", "openclaw", "op", "--version",
        ],
        { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
      );
    } catch {
      // Container may not be running — check if op is expected in build
      // This is a non-fatal warning since the container might not be running
      return fail(
        name,
        "warning",
        "1Password token configured but op CLI not reachable in container",
        "Run: clawhq build with 1Password enabled blueprint to install op CLI",
      );
    }

    return ok(name, "1Password configured: token valid, op CLI available");
  } catch {
    return ok(name, "1Password check inconclusive", "info");
  }
}

// ── 23. Sanitize Tool Available ───────��─────────────────────────────────────

/** Check that the sanitize (ClawWall) tool is on PATH and quarantine log is writable. */
async function checkSanitizeAvailable(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "sanitize-available";

  try {
    // Check the tool exists and is executable (check both legacy and new paths)
    const paths = [
      join(deployDir, "workspace", "sanitize"),
      join(deployDir, "workspace", "tools", "sanitize"),
    ];
    const found = await Promise.all(paths.map(async (p) => {
      try { await access(p, constants.X_OK); return true; } catch { return false; }
    }));
    if (!found.some(Boolean)) {
      return fail(
        name,
        "error",
        "sanitize tool not found — prompt injection defense is inactive",
        "Run 'clawhq init' to regenerate workspace tools",
        false,
      );
    }

    // Check quarantine log directory is writable
    const securityDir = join(deployDir, "ops", "security");
    try {
      await access(securityDir, constants.W_OK);
    } catch {
      // Directory may not exist yet — try to check parent
      const opsDir = join(deployDir, "ops");
      try {
        await access(opsDir, constants.W_OK);
      } catch {
        return fail(
          name,
          "warning",
          "Quarantine log directory not writable — sanitizer audit logs will fail silently",
          "Run 'mkdir -p ~/.clawhq/ops/security && chmod 700 ~/.clawhq/ops/security'",
        );
      }
    }

    return ok(name, "sanitize tool available, quarantine log writable");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(name, "warning", `Sanitize check failed: ${msg}`);
  }
}

// ── 24. Auto-Update Timer Active ────────────────────────────────────────────

/** Check that the auto-update systemd timer is active. */
async function checkOpsAutoUpdateActive(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "ops-autoupdate-active";

  // First check if ops automation scripts were generated
  const scriptPath = join(deployDir, "ops", "automation", "scripts", "clawhq-autoupdate.sh");
  try {
    await access(scriptPath, constants.R_OK);
  } catch {
    return fail(
      name,
      "info",
      "Auto-update script not found — run clawhq init to generate ops automation",
      "Run: clawhq init --guided",
    );
  }

  // Check if timer is active
  const active = await isTimerActive("clawhq-autoupdate.timer", signal);
  if (!active) {
    return fail(
      name,
      "warning",
      "Auto-update timer is not active — updates will not run automatically",
      "Run: clawhq ops install",
    );
  }

  return ok(name, "Auto-update timer is active");
}

// ── 25. Backup Recent ──────────────────────────────────────────────────────

/** Check that workspace backup has run recently. */
async function checkOpsBackupRecent(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "ops-backup-recent";

  // Check if backup script exists
  const scriptPath = join(deployDir, "ops", "automation", "scripts", "clawhq-backup.sh");
  try {
    await access(scriptPath, constants.R_OK);
  } catch {
    return fail(
      name,
      "info",
      "Backup script not found — run clawhq init to generate ops automation",
      "Run: clawhq init --guided",
    );
  }

  // Check for recent backup snapshots
  const backupDir = join(deployDir, "ops", "backup", "incremental");
  const latestLink = join(backupDir, "latest");
  try {
    const latestStat = await stat(latestLink);
    const ageMs = Date.now() - latestStat.mtimeMs;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays > 7) {
      return fail(
        name,
        "warning",
        `Last backup is ${Math.floor(ageDays)} days old — recommend daily backups`,
        "Run: clawhq ops install to enable backup timer, or run backup script manually",
      );
    }
    return ok(name, `Last backup: ${Math.floor(ageDays)} day(s) ago`);
  } catch {
    // No backup yet — check if timer is at least active
    const timerActive = await isTimerActive("clawhq-backup.timer", signal);
    if (timerActive) {
      return ok(name, "Backup timer active, awaiting first run", "info");
    }
    return fail(
      name,
      "warning",
      "No backups found and backup timer is not active",
      "Run: clawhq ops install",
    );
  }
}

// ── 26. Security Monitor Running ───────────────────────────────────────────

/** Check that the security monitor is active. */
async function checkOpsSecurityMonitor(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "ops-security-monitor";

  // Check if script exists
  const scriptPath = join(deployDir, "ops", "automation", "scripts", "clawhq-security-monitor.sh");
  try {
    await access(scriptPath, constants.R_OK);
  } catch {
    return fail(
      name,
      "info",
      "Security monitor script not found — run clawhq init to generate ops automation",
      "Run: clawhq init --guided",
    );
  }

  // Check if timer is active
  const active = await isTimerActive("clawhq-security-monitor.timer", signal);
  if (!active) {
    return fail(
      name,
      "warning",
      "Security monitor timer is not active — CVE alerts will not be generated",
      "Run: clawhq ops install",
    );
  }

  return ok(name, "Security monitor timer is active");
}

// ── 27. Credential Proxy Healthy ──────────────────────────────────────────

/** Check that the credential proxy sidecar is reachable and routes are configured. */
async function checkCredProxyHealthy(
  deployDir: string,
  signal?: AbortSignal,
): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "cred-proxy-healthy";

  // First check if cred-proxy routes config exists — if not, proxy isn't enabled
  const routesPath = join(deployDir, "engine", "cred-proxy-routes.json");
  try {
    await access(routesPath, constants.R_OK);
  } catch {
    return ok(name, "Credential proxy not configured (optional)", "info");
  }

  // Routes exist, so proxy should be running. Check if it's reachable.
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", join(deployDir, "engine", "docker-compose.yml"), "ps", "--format", "json", "cred-proxy"],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );

    // Parse container status
    if (!stdout.trim()) {
      return fail(
        name,
        "error",
        "Credential proxy container is not running",
        "Run: clawhq up",
      );
    }

    // Try health endpoint via docker exec
    const { stdout: healthOut } = await execFileAsync(
      "docker",
      [
        "compose", "-f", join(deployDir, "engine", "docker-compose.yml"),
        "exec", "-T", "cred-proxy",
        "node", "-e",
        `require("http").get("http://localhost:${CRED_PROXY_PORT}/health",(r)=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>console.log(d))}).on("error",e=>console.error(e.message))`,
      ],
      { timeout: DOCTOR_EXEC_TIMEOUT_MS, signal },
    );

    const health = JSON.parse(healthOut.trim());
    const routeCount = health.routes?.length ?? 0;
    const configured = health.routes?.filter((r: { credConfigured: boolean }) => r.credConfigured).length ?? 0;

    if (configured === 0 && routeCount > 0) {
      return fail(
        name,
        "warning",
        `Credential proxy running with ${routeCount} route(s) but no credentials configured`,
        "Run: clawhq creds to configure API keys",
      );
    }

    return ok(name, `Credential proxy healthy: ${configured}/${routeCount} route(s) with credentials`);
  } catch {
    return fail(
      name,
      "warning",
      "Credential proxy is configured but health check failed",
      "Run: clawhq up to start the proxy sidecar",
    );
  }
}

// ── 28. Egress Domains Coverage ─────────────────────────────────────────────

/**
 * Verify that all configured integrations have their egress domains in the allowlist.
 *
 * Reads .env to detect which integrations are configured, looks up their
 * required egress domains from the registry, and checks the allowlist covers them.
 */
async function checkEgressDomainsCoverage(deployDir: string): Promise<DoctorCheckResult> {
  const name: DoctorCheckName = "egress-domains-coverage";

  try {
    // Read .env to detect configured integrations
    const envPath = join(deployDir, "engine", ".env");
    let envContent: string;
    try {
      envContent = await readFile(envPath, "utf-8");
    } catch {
      return ok(name, "No .env file — skipping egress domain coverage check", "info");
    }

    const envKeys = new Set(
      envContent.split("\n")
        .map((line) => line.split("=")[0]?.trim())
        .filter((k): k is string => !!k && !k.startsWith("#")),
    );

    // Detect which integrations are configured by matching env key prefixes
    const configuredIntegrations: string[] = [];
    for (const [integrationName, def] of Object.entries(INTEGRATION_REGISTRY)) {
      if (def.egressDomains.length === 0) continue; // skip integrations with no egress needs
      const prefix = integrationName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      const hasKeys = def.envKeys.some((ek) => envKeys.has(`${prefix}_${ek.key.toUpperCase()}`));
      if (hasKeys) {
        configuredIntegrations.push(integrationName);
      }
    }

    if (configuredIntegrations.length === 0) {
      return ok(name, "No integrations with egress requirements detected");
    }

    // Collect required domains
    const requiredDomains = collectIntegrationDomains(configuredIntegrations);

    // Load current allowlist
    const allowlist = await loadAllowlist(deployDir);
    const allowedDomains = new Set(allowlist.map((e) => e.domain));

    // Find missing domains
    const missing = requiredDomains.filter((d) => !allowedDomains.has(d));

    if (missing.length > 0) {
      return fail(
        name,
        "warning",
        `Missing egress domains for configured integrations: ${missing.join(", ")}`,
        "Run: clawhq init to regenerate the allowlist with current integrations",
        true,
      );
    }

    return ok(name, `All ${configuredIntegrations.length} integration(s) have required egress domains in allowlist`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(name, "warning", `Cannot check egress domain coverage: ${msg}`);
  }
}
