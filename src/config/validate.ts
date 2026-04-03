/**
 * 14 landmine validation rules for OpenClaw configuration.
 *
 * Every rule was discovered running a production agent. Each silently breaks
 * the agent — no errors, no warnings. The validator catches them before deploy.
 *
 * See docs/OPENCLAW-REFERENCE.md § "The 14 Configuration Landmines" for details.
 */

import { BOOTSTRAP_MAX_CHARS, CONTAINER_USER, GATEWAY_DEFAULT_PORT } from "./defaults.js";
import type {
  ComposeConfig,
  ComposeServiceConfig,
  CronJobDefinition,
  DeploymentBundle,
  IdentityFileInfo,
  OpenClawConfig,
  ValidationReport,
  ValidationResult,
  VolumeMount,
} from "./types.js";

// ── Constants ───────────────────────────────────────────────────────────────

/** Default bootstrap character limit for identity files. */
const DEFAULT_BOOTSTRAP_MAX_CHARS = BOOTSTRAP_MAX_CHARS;

// Cron stepping syntax regex.
//
// OpenClaw rejects bare `N/step` (e.g. `5/15`). Valid forms:
// - `start-end/step` (e.g. `3-58/15`)
// - `*/step` (e.g. `*/10`)
//
// Each of the 5 cron fields is validated independently.
const INVALID_CRON_STEP = /^(\d+)\/(\d+)$/;

// ── Individual Rules ────────────────────────────────────────────────────────

/**
 * LM-01: Device signature loop.
 *
 * Without `dangerouslyDisableDeviceAuth: true`, the Gateway enters a
 * "device signature invalid" loop and the agent becomes inaccessible.
 */
export function validateLM01(config: OpenClawConfig): ValidationResult {
  // Check both legacy top-level and new nested location
  const passed = config.dangerouslyDisableDeviceAuth === true
    || config.gateway?.controlUi?.dangerouslyDisableDeviceAuth === true;
  return {
    rule: "LM-01",
    passed,
    severity: "error",
    message: passed
      ? "Device auth correctly disabled"
      : "dangerouslyDisableDeviceAuth must be true — without it the agent enters a device signature loop and becomes inaccessible",
    fix: 'Set "gateway.controlUi.dangerouslyDisableDeviceAuth": true in openclaw.json',
  };
}

/**
 * LM-02: CORS errors.
 *
 * If `allowedOrigins` is empty or missing, the control UI returns CORS
 * errors and the agent can't be managed via web.
 */
export function validateLM02(config: OpenClawConfig): ValidationResult {
  // Check both legacy top-level and new nested location
  const origins = config.allowedOrigins ?? config.gateway?.controlUi?.allowedOrigins;
  const passed = Array.isArray(origins) && origins.length > 0;
  return {
    rule: "LM-02",
    passed,
    severity: "error",
    message: passed
      ? `allowedOrigins has ${origins.length} origin(s)`
      : "allowedOrigins is empty or missing — the control UI will return CORS errors",
    fix: `Add expected origins to "gateway.controlUi.allowedOrigins" array (e.g. ["http://127.0.0.1:${GATEWAY_DEFAULT_PORT}"])`,
  };
}

/**
 * LM-03: Docker NAT rejection.
 *
 * If `trustedProxies` is empty or missing, the Gateway rejects requests
 * routed through Docker's NAT.
 */
export function validateLM03(config: OpenClawConfig): ValidationResult {
  // Check both legacy top-level and new nested location
  const proxies = config.trustedProxies ?? config.gateway?.trustedProxies;
  const passed = Array.isArray(proxies) && proxies.length > 0;
  return {
    rule: "LM-03",
    passed,
    severity: "error",
    message: passed
      ? `trustedProxies has ${proxies.length} entry/entries`
      : "trustedProxies is empty or missing — the Gateway will reject requests through Docker NAT",
    fix: 'Add Docker bridge gateway IP to "gateway.trustedProxies" (e.g. ["172.17.0.1"])',
  };
}

/**
 * LM-04: Tool execution unavailable.
 *
 * `tools.exec.host` must be `"gateway"`. `"node"` fails without a companion
 * process, `"sandbox"` fails without Docker-in-Docker.
 */
export function validateLM04(config: OpenClawConfig): ValidationResult {
  const host = config.tools?.exec?.host;
  const passed = host === "gateway";
  return {
    rule: "LM-04",
    passed,
    severity: "error",
    message: passed
      ? 'tools.exec.host is "gateway"'
      : `tools.exec.host is "${host ?? "undefined"}" — must be "gateway" (node fails without companion, sandbox fails without Docker-in-Docker)`,
    fix: 'Set "tools.exec.host": "gateway" in openclaw.json',
  };
}

/**
 * LM-05: Tool security restrictions silently applied.
 *
 * `tools.exec.security` must be `"full"` or tool execution is silently
 * restricted without warning.
 */
export function validateLM05(config: OpenClawConfig): ValidationResult {
  const security = config.tools?.exec?.security;
  const passed = security === "full";
  return {
    rule: "LM-05",
    passed,
    severity: "error",
    message: passed
      ? 'tools.exec.security is "full"'
      : `tools.exec.security is "${security ?? "undefined"}" — must be "full" or tool execution will be silently restricted`,
    fix: 'Set "tools.exec.security": "full" in openclaw.json',
  };
}

/**
 * LM-06: Volume mount permission errors.
 *
 * Container must run as UID 1000 or volume mounts will have permission errors.
 */
export function validateLM06(compose: ComposeConfig): ValidationResult {
  const service = findAgentService(compose);
  const user = service?.user;
  const expectedUid = CONTAINER_USER.split(":")[0];
  const passed = user === CONTAINER_USER || user === expectedUid;
  return {
    rule: "LM-06",
    passed,
    severity: "error",
    message: passed
      ? `Container user is ${CONTAINER_USER}`
      : `Container user is "${user ?? "not set"}" — must be "${CONTAINER_USER}" or mounted volumes will have permission errors`,
    fix: `Set "user": "${CONTAINER_USER}" in docker-compose.yml service`,
  };
}

/**
 * LM-07: Container escape vulnerability.
 *
 * ICC (inter-container communication) must be disabled and caps must be
 * dropped. Missing `cap_drop: ALL` or `no-new-privileges` is a security breach.
 */
export function validateLM07(compose: ComposeConfig): ValidationResult {
  const service = findAgentService(compose);
  const caps = service?.cap_drop ?? [];
  const secOpts = service?.security_opt ?? [];

  const hasCapDropAll = caps.some(
    (c) => c.toLowerCase() === "all",
  );
  const hasNoNewPriv = secOpts.some(
    (o) => o === "no-new-privileges" || o === "no-new-privileges:true",
  );
  const passed = hasCapDropAll && hasNoNewPriv;

  const missing: string[] = [];
  if (!hasCapDropAll) missing.push("cap_drop: ALL");
  if (!hasNoNewPriv) missing.push("security_opt: no-new-privileges");

  return {
    rule: "LM-07",
    passed,
    severity: "error",
    message: passed
      ? "Container hardening in place (cap_drop ALL, no-new-privileges)"
      : `Missing container hardening: ${missing.join(", ")} — container escape vulnerability`,
    fix: "Add cap_drop: [ALL] and security_opt: [no-new-privileges] to docker-compose.yml",
  };
}

/**
 * LM-08: Identity files silently truncated.
 *
 * If identity files exceed `bootstrapMaxChars`, the Gateway silently
 * truncates them and the agent loses personality context.
 */
export function validateLM08(
  config: OpenClawConfig,
  identityFiles: readonly IdentityFileInfo[],
): ValidationResult {
  const maxChars = config.identity?.bootstrapMaxChars ?? DEFAULT_BOOTSTRAP_MAX_CHARS;
  const totalSize = identityFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
  const passed = totalSize <= maxChars;

  return {
    rule: "LM-08",
    passed,
    severity: "error",
    message: passed
      ? `Identity files total ${totalSize} chars (limit: ${maxChars})`
      : `Identity files total ${totalSize} chars, exceeding bootstrapMaxChars limit of ${maxChars} — files will be silently truncated`,
    fix: `Reduce identity file sizes to fit within ${maxChars} chars, or increase bootstrapMaxChars`,
  };
}

// LM-09: Cron jobs silently don't run.
//
// OpenClaw rejects bare stepping syntax like `5/15`. Must use `start-end/step`
// (e.g. `3-58/15`) or `*/step`.
export function validateLM09(
  cronJobs: readonly CronJobDefinition[],
): ValidationResult {
  const invalidJobs: string[] = [];

  for (const job of cronJobs) {
    if (job.kind !== "cron" || !job.expr) continue;
    const fields = job.expr.trim().split(/\s+/);
    for (const field of fields) {
      if (INVALID_CRON_STEP.test(field)) {
        invalidJobs.push(`${job.id} (field "${field}")`);
        break;
      }
    }
  }

  const passed = invalidJobs.length === 0;
  return {
    rule: "LM-09",
    passed,
    severity: "error",
    message: passed
      ? "All cron expressions use valid stepping syntax"
      : `Invalid cron stepping syntax in: ${invalidJobs.join(", ")} — use "start-end/step" (e.g. "3-58/15") not bare "N/step"`,
    fix: 'Replace bare "N/step" with "start-end/step" in cron expressions (e.g. "5/15" → "3-58/15")',
  };
}

/**
 * LM-10: Docker Compose deploy failure.
 *
 * External networks referenced in compose must exist before deploy.
 * This rule checks that external networks are declared.
 */
export function validateLM10(compose: ComposeConfig): ValidationResult {
  const networks = compose.networks ?? {};
  const serviceNetworks = new Set<string>();

  for (const svc of Object.values(compose.services ?? {})) {
    for (const net of svc.networks ?? []) {
      serviceNetworks.add(net);
    }
  }

  const undeclared = Array.from(serviceNetworks).filter((n) => !(n in networks));
  const passed = undeclared.length === 0;

  return {
    rule: "LM-10",
    passed,
    severity: "error",
    message: passed
      ? "All service networks are declared"
      : `Undeclared networks referenced by services: ${undeclared.join(", ")} — docker compose will fail`,
    fix: "Declare all referenced networks in the networks section of docker-compose.yml",
  };
}

/**
 * LM-11: Integration APIs silently fail.
 *
 * `.env` must contain all required variables referenced in compose
 * environment or env_file. Missing variables cause integrations to
 * silently fail at runtime.
 */
export function validateLM11(
  compose: ComposeConfig,
  envVars: Record<string, string>,
): ValidationResult {
  const service = findAgentService(compose);
  const requiredVars = new Set<string>();

  // Collect env var references from compose environment
  const envMap = service?.environment ?? {};
  for (const [, value] of Object.entries(envMap)) {
    const ref = extractEnvRef(value);
    if (ref) requiredVars.add(ref);
  }

  const missing = Array.from(requiredVars).filter((v) => !(v in envVars));
  const passed = missing.length === 0;

  return {
    rule: "LM-11",
    passed,
    severity: "error",
    message: passed
      ? "All required environment variables are set"
      : `Missing .env variables: ${missing.join(", ")} — integrations will silently fail`,
    fix: `Add missing variables to .env: ${missing.join(", ")}`,
  };
}

/**
 * LM-12: Agent modifies its own config.
 *
 * Config and credential files must be mounted read-only so the agent
 * can't modify its own configuration at runtime.
 */
export function validateLM12(compose: ComposeConfig): ValidationResult {
  const service = findAgentService(compose);
  const volumes = service?.volumes ?? [];

  const configPaths = ["openclaw.json", "credentials.json"];
  const writableConfigs: string[] = [];

  for (const vol of volumes) {
    const mount = parseVolumeMount(vol);
    if (!mount) continue;
    for (const configPath of configPaths) {
      if (mount.source.includes(configPath) && !mount.readOnly) {
        writableConfigs.push(configPath);
      }
    }
  }

  const passed = writableConfigs.length === 0;
  return {
    rule: "LM-12",
    passed,
    severity: "error",
    message: passed
      ? "Config files are read-only mounted"
      : `Config files mounted writable: ${writableConfigs.join(", ")} — agent can modify its own config`,
    fix: "Add :ro flag to config file volume mounts in docker-compose.yml",
  };
}

/**
 * LM-13: Network egress unfiltered.
 *
 * This rule checks that the compose config uses a network with ICC disabled
 * (driver_opts com.docker.network.bridge.enable_icc=false). Full firewall
 * verification requires runtime `iptables` checks via `clawhq doctor`.
 */
export function validateLM13(compose: ComposeConfig): ValidationResult {
  const networks = compose.networks ?? {};
  let hasIccDisabled = false;

  for (const net of Object.values(networks)) {
    if (net.driver_opts?.["com.docker.network.bridge.enable_icc"] === "false") {
      hasIccDisabled = true;
      break;
    }
  }

  const passed = hasIccDisabled;
  return {
    rule: "LM-13",
    passed,
    severity: "warning",
    message: passed
      ? "Network has ICC disabled"
      : "No network with ICC disabled found — egress may be unfiltered. Run clawhq doctor to verify iptables rules",
    fix: 'Add driver_opts: { "com.docker.network.bridge.enable_icc": "false" } to agent network',
  };
}

/**
 * LM-14: Filesystem access misconfigured.
 *
 * `fs.workspaceOnly` must be explicitly set. Too permissive = reads host FS.
 * Too restrictive = can't read media files.
 */
export function validateLM14(config: OpenClawConfig): ValidationResult {
  const workspaceOnly = config.fs?.workspaceOnly;
  const passed = workspaceOnly !== undefined;
  return {
    rule: "LM-14",
    passed,
    severity: "warning",
    message: passed
      ? `fs.workspaceOnly is ${workspaceOnly}`
      : "fs.workspaceOnly is not set — filesystem access may be too permissive (reads host) or too restrictive (blocks media)",
    fix: "Set fs.workspaceOnly to true (recommended) or false (if agent needs media access outside workspace)",
  };
}

// ── Full Validation ─────────────────────────────────────────────────────────

/**
 * Run all 14 landmine validation rules against a deployment bundle.
 *
 * Returns a report with individual results, aggregated errors and warnings.
 */
export function validateBundle(bundle: DeploymentBundle): ValidationReport {
  const results: ValidationResult[] = [
    // openclaw.json rules
    validateLM01(bundle.openclawConfig),
    validateLM02(bundle.openclawConfig),
    validateLM03(bundle.openclawConfig),
    validateLM04(bundle.openclawConfig),
    validateLM05(bundle.openclawConfig),
    // compose rules
    validateLM06(bundle.composeConfig),
    validateLM07(bundle.composeConfig),
    // cross-surface rules
    validateLM08(bundle.openclawConfig, bundle.identityFiles),
    validateLM09(bundle.cronJobs),
    validateLM10(bundle.composeConfig),
    validateLM11(bundle.composeConfig, bundle.envVars),
    validateLM12(bundle.composeConfig),
    validateLM13(bundle.composeConfig),
    validateLM14(bundle.openclawConfig),
  ];

  const errors = results.filter((r) => !r.passed && r.severity === "error");
  const warnings = results.filter((r) => !r.passed && r.severity === "warning");

  return {
    valid: errors.length === 0,
    results,
    errors,
    warnings,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Find the primary agent service in a compose config. */
function findAgentService(
  compose: ComposeConfig,
): ComposeServiceConfig | undefined {
  const services = compose.services ?? {};
  // Look for common service names
  return (
    services["openclaw"] ??
    services["agent"] ??
    services["gateway"] ??
    Object.values(services)[0]
  );
}

/** Extract `$VAR` or `${VAR}` references from a compose environment value. */
function extractEnvRef(value: string): string | null {
  const match = value.match(/^\$\{([^}:]+?)(?::.*?)?\}$|^\$([A-Z_][A-Z0-9_]*)$/);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/** Parse a volume mount string or object into a normalized form. */
function parseVolumeMount(
  vol: string | VolumeMount,
): { source: string; target: string; readOnly: boolean } | null {
  if (typeof vol === "object") {
    return { source: vol.source, target: vol.target, readOnly: vol.readOnly ?? false };
  }
  // Parse "source:target:flags" string format
  const parts = vol.split(":");
  const source = parts[0];
  const target = parts[1];
  if (!source || !target) return null;
  return {
    source,
    target,
    readOnly: parts[2] === "ro",
  };
}
