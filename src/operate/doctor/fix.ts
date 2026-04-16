/**
 * Auto-fix for doctor diagnostic issues.
 *
 * Each fixer resolves a common issue without requiring the user to understand
 * internals. Fixes are conservative — they only change what's broken.
 */

import { chmod, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as yamlParse, stringify as yamlStringify } from "yaml";

import { CONTAINER_USER, FILE_MODE_SECRET, GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import { InvalidCronStoreError, loadCronStore, saveCronStore } from "../../openclaw/cron-store.js";
import { archiveSession, listSessions } from "../sessions/index.js";

import type { DoctorCheckResult, DoctorCheckName, FixReport, FixResult } from "./types.js";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run auto-fixes for all fixable failed checks.
 *
 * Only attempts fixes for checks that:
 * 1. Failed (passed === false)
 * 2. Have fixable === true
 */
export async function runFixes(
  deployDir: string,
  checks: readonly DoctorCheckResult[],
): Promise<FixReport> {
  const fixable = checks.filter((c) => !c.passed && c.fixable);

  if (fixable.length === 0) {
    return { fixes: [], fixed: 0, failed: 0 };
  }

  const fixes: FixResult[] = [];
  for (const check of fixable) {
    const fixer = fixers[check.name];
    if (fixer) {
      fixes.push(await fixer(deployDir));
    }
  }

  const fixed = fixes.filter((f) => f.success).length;
  const failed = fixes.filter((f) => !f.success).length;

  return { fixes, fixed, failed };
}

// ── Fixers ──────────────────────────────────────────────────────────────────

type Fixer = (deployDir: string) => Promise<FixResult>;

const fixers: Partial<Record<DoctorCheckName, Fixer>> = {
  "secrets-perms": fixSecretsPerms,
  "creds-perms": fixCredsPerms,
  "config-valid": fixConfigLandmines,
  "cap-drop": fixCapDrop,
  "no-new-privileges": fixNoNewPrivileges,
  "user-uid": fixUserUid,
  "tool-access-grants": fixToolAccessGrants,
  "cron-health": fixCronHealth,
  "session-runaway": fixSessionRunaway,
  "loop-detection-enabled": fixLoopDetection,
};

/**
 * Enable tool-loop detection in openclaw.json with safe thresholds.
 *
 * Matches the defaults written by `clawhq init` so this fix brings an
 * existing deployment up to the same baseline.
 */
async function fixLoopDetection(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "loop-detection-enabled";
  const configPath = join(deployDir, "engine", "openclaw.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;

    let tools = config["tools"] as Record<string, unknown> | undefined;
    if (!tools) {
      tools = {};
      config["tools"] = tools;
    }
    tools["loopDetection"] = {
      enabled: true,
      historySize: 30,
      warningThreshold: 10,
      criticalThreshold: 20,
      globalCircuitBreakerThreshold: 30,
      unknownToolThreshold: 5,
      detectors: {
        genericRepeat: true,
        knownPollNoProgress: true,
        pingPong: true,
      },
    };

    const diagnostics = (config["diagnostics"] as Record<string, unknown> | undefined) ?? {};
    if (diagnostics["stuckSessionWarnMs"] === undefined) {
      diagnostics["stuckSessionWarnMs"] = 5 * 60_000;
    }
    config["diagnostics"] = diagnostics;

    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return {
      name,
      success: true,
      message: "Enabled tools.loopDetection and set diagnostics.stuckSessionWarnMs",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, success: false, message: `Failed to patch loop detection: ${msg}` };
  }
}

/** Archive all runaway sessions detected inside the container, then restart. */
async function fixSessionRunaway(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "session-runaway";
  try {
    const sessions = await listSessions();
    const runaway = sessions.filter((s) => s.flags.length > 0);
    if (runaway.length === 0) {
      return { name, success: true, message: "No runaway sessions to archive" };
    }
    const archived: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < runaway.length; i++) {
      // Only restart on the last archive to avoid multiple restarts.
      const restart = i === runaway.length - 1;
      const res = await archiveSession(runaway[i].id, deployDir, { restart });
      if (res.success) archived.push(res.sessionId.slice(0, 8));
      else failed.push(`${res.sessionId.slice(0, 8)}: ${res.message}`);
    }
    if (failed.length > 0) {
      return {
        name,
        success: false,
        message: `Archived ${archived.length}, failed ${failed.length}: ${failed.join("; ")}`,
      };
    }
    return { name, success: true, message: `Archived ${archived.length} runaway session(s): ${archived.join(", ")}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, success: false, message: `Failed to archive runaway sessions: ${msg}` };
  }
}

/** Fix .env file permissions to 0600. */
async function fixSecretsPerms(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "secrets-perms";
  const envPath = join(deployDir, "engine", ".env");
  try {
    await chmod(envPath, FILE_MODE_SECRET);
    return { name, success: true, message: "Set .env permissions to 600" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, success: false, message: `Failed to chmod .env: ${msg}` };
  }
}

/** Fix credentials.json file permissions to 0600. */
async function fixCredsPerms(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "creds-perms";
  const credsPath = join(deployDir, "engine", "credentials.json");
  try {
    await chmod(credsPath, FILE_MODE_SECRET);
    return { name, success: true, message: "Set credentials.json permissions to 600" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, success: false, message: `Failed to chmod credentials.json: ${msg}` };
  }
}

/** Fix critical landmine violations in openclaw.json. */
async function fixConfigLandmines(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "config-valid";
  const configPath = join(deployDir, "engine", "openclaw.json");

  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const fixes: string[] = [];

    // LM-01: dangerouslyDisableDeviceAuth
    if (config["dangerouslyDisableDeviceAuth"] !== true) {
      config["dangerouslyDisableDeviceAuth"] = true;
      fixes.push("LM-01: set dangerouslyDisableDeviceAuth to true");
    }

    // LM-02: allowedOrigins
    const origins = config["allowedOrigins"];
    if (!Array.isArray(origins) || origins.length === 0) {
      config["allowedOrigins"] = [`http://localhost:${GATEWAY_DEFAULT_PORT}`];
      fixes.push(`LM-02: set allowedOrigins to [http://localhost:${GATEWAY_DEFAULT_PORT}]`);
    }

    // LM-03: trustedProxies
    const proxies = config["trustedProxies"];
    if (!Array.isArray(proxies) || proxies.length === 0) {
      config["trustedProxies"] = ["172.17.0.1"];
      fixes.push("LM-03: set trustedProxies to [172.17.0.1]");
    }

    // LM-02/LM-03 nested: gateway.controlUi.allowedOrigins, gateway.trustedProxies
    const gateway = config["gateway"] as Record<string, unknown> | undefined;
    if (gateway) {
      const controlUi = gateway["controlUi"] as Record<string, unknown> | undefined;
      if (controlUi) {
        const nestedOrigins = controlUi["allowedOrigins"];
        if (Array.isArray(nestedOrigins) && nestedOrigins.length === 0) {
          controlUi["allowedOrigins"] = [`http://localhost:${GATEWAY_DEFAULT_PORT}`];
          fixes.push("LM-02: set gateway.controlUi.allowedOrigins");
        }
      }
      const nestedProxies = gateway["trustedProxies"];
      if (Array.isArray(nestedProxies) && nestedProxies.length === 0) {
        gateway["trustedProxies"] = ["172.17.0.1"];
        fixes.push("LM-03: set gateway.trustedProxies");
      }
    }

    // LM-04 & LM-05: tools.exec
    let tools = config["tools"] as Record<string, unknown> | undefined;
    if (!tools) {
      tools = {};
      config["tools"] = tools;
    }
    let exec = tools["exec"] as Record<string, unknown> | undefined;
    if (!exec) {
      exec = {};
      tools["exec"] = exec;
    }
    if (exec["host"] !== "gateway") {
      exec["host"] = "gateway";
      fixes.push('LM-04: set tools.exec.host to "gateway"');
    }
    if (exec["security"] !== "full") {
      exec["security"] = "full";
      fixes.push('LM-05: set tools.exec.security to "full"');
    }

    if (fixes.length === 0) {
      return { name, success: true, message: "No landmine fixes needed" };
    }

    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return { name, success: true, message: `Fixed ${fixes.length} landmine(s): ${fixes.join("; ")}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, success: false, message: `Failed to fix config: ${msg}` };
  }
}

/** Fix missing cap_drop: ALL in docker-compose.yml. */
async function fixCapDrop(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "cap-drop";
  return patchCompose(deployDir, name, (compose) => {
    const entry = getFirstServiceEntry(compose);
    if (!entry) return null;
    const [, svc] = entry;
    if (Array.isArray(svc.cap_drop) && svc.cap_drop.includes("ALL")) return null;
    svc.cap_drop = ["ALL"];
    return { message: "Added cap_drop: [ALL] to compose" };
  });
}

/** Fix missing no-new-privileges in docker-compose.yml. */
async function fixNoNewPrivileges(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "no-new-privileges";
  return patchCompose(deployDir, name, (compose) => {
    const entry = getFirstServiceEntry(compose);
    if (!entry) return null;
    const [, svc] = entry;
    if (Array.isArray(svc.security_opt) && svc.security_opt.includes("no-new-privileges")) {
      return null;
    }
    const existing = Array.isArray(svc.security_opt) ? svc.security_opt : [];
    svc.security_opt = [...existing, "no-new-privileges"];
    return { message: "Added security_opt: [no-new-privileges] to compose" };
  });
}

/** Fix missing user in docker-compose.yml. */
async function fixUserUid(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "user-uid";
  const expectedUid = CONTAINER_USER.split(":")[0];
  return patchCompose(deployDir, name, (compose) => {
    const entry = getFirstServiceEntry(compose);
    if (!entry) return null;
    const [, svc] = entry;
    const current = String(svc.user ?? "");
    if (current.startsWith(expectedUid)) return null;
    svc.user = CONTAINER_USER;
    return { message: `Set user: "${CONTAINER_USER}" in compose` };
  });
}

/** Fix missing tool access grants in openclaw.json (OpenClaw v0.8.7+). */
async function fixToolAccessGrants(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "tool-access-grants";
  const configPath = join(deployDir, "engine", "openclaw.json");

  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;

    let tools = config["tools"] as Record<string, unknown> | undefined;
    if (!tools) {
      tools = {};
      config["tools"] = tools;
    }

    const existing = tools["accessGrants"] as unknown[] | undefined;
    if (Array.isArray(existing) && existing.length > 0) {
      return { name, success: true, message: "Tool access grants already set" };
    }

    tools["accessGrants"] = [{ type: "user", value: "*" }];
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return { name, success: true, message: 'Added tools.accessGrants: [{"type":"user","value":"*"}]' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, success: false, message: `Failed to fix tool access grants: ${msg}` };
  }
}

/**
 * Fix cron health issues: clear stale error state and add missing sessionTarget.
 *
 * Stale error state (lastRunStatus, lastError, consecutiveErrors) in jobs.json
 * causes the OpenClaw cron scheduler to crash with "Cannot read properties of
 * undefined (reading 'runningAtMs')" on startup. Missing sessionTarget causes
 * job execution to crash with "Cannot read properties of undefined (reading 'startsWith')".
 */
async function fixCronHealth(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "cron-health";
  const cronPath = join(deployDir, "cron", "jobs.json");

  try {
    // loadCronStore throws InvalidCronStoreError on envelope drift — caught
    // below and surfaced as a fix failure with a clear "run clawhq apply"
    // pointer, matching the message users see from the cron-schema check.
    const envelope = loadCronStore(cronPath);
    const jobs = envelope.jobs as Array<Record<string, unknown>>;

    const fixes: string[] = [];

    for (const job of jobs) {
      const id = typeof job.id === "string" ? job.id : "unknown";
      const state = job.state as Record<string, unknown> | undefined;

      // Clear stale error state that crashes the scheduler
      if (state) {
        const staleKeys = ["lastRunStatus", "lastStatus", "lastError", "consecutiveErrors", "lastDurationMs", "lastDeliveryStatus", "lastRunAtMs"];
        let cleared = false;
        for (const key of staleKeys) {
          if (key in state) {
            Reflect.deleteProperty(state, key);
            cleared = true;
          }
        }
        if (cleared) fixes.push(`${id}: cleared stale error state`);
      }

      // Ensure state object exists
      if (!job.state) {
        job.state = {};
        fixes.push(`${id}: created empty state`);
      }

      // Add missing sessionTarget
      if (!job.sessionTarget) {
        const payload = job.payload as Record<string, unknown> | undefined;
        const kind = typeof payload?.kind === "string" ? payload.kind : "";
        job.sessionTarget = kind === "systemEvent" ? "main" : "isolated";
        fixes.push(`${id}: added sessionTarget="${job.sessionTarget}"`);
      }
    }

    if (fixes.length === 0) {
      return { name, success: true, message: "No cron health fixes needed" };
    }

    const backupPath = cronPath + ".bak";
    await copyFile(cronPath, backupPath);
    // saveCronStore writes atomically (tmp+rename) and guarantees canonical
    // envelope — eliminates the non-atomic writeFile that previously left
    // the file inconsistent on crash.
    saveCronStore(cronPath, { version: 1, jobs });
    return { name, success: true, message: `Fixed ${fixes.length} issue(s): ${fixes.join("; ")}` };
  } catch (err) {
    if (err instanceof InvalidCronStoreError) {
      return { name, success: false, message: err.message };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { name, success: false, message: `Failed to fix cron health: ${msg}` };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the first [serviceName, serviceConfig] from compose.services dynamically. */
function getFirstServiceEntry(
  compose: Record<string, unknown>,
): [string, Record<string, unknown>] | null {
  const services = compose["services"] as Record<string, unknown> | undefined;
  if (!services || typeof services !== "object") return null;
  const keys = Object.keys(services);
  if (keys.length === 0) return null;
  const name = keys[0];
  const svc = services[name] as Record<string, unknown>;
  if (!svc || typeof svc !== "object") return null;
  return [name, svc];
}

/**
 * Parse compose file as YAML, apply patcher to the parsed object, validate
 * round-trip, create backup, and write. Patcher returns {message} on change
 * or null if no change needed.
 */
async function patchCompose(
  deployDir: string,
  name: DoctorCheckName,
  patcher: (compose: Record<string, unknown>) => { message: string } | null,
): Promise<FixResult> {
  const composePath = join(deployDir, "engine", "docker-compose.yml");
  const backupPath = composePath + ".bak";
  try {
    const raw = await readFile(composePath, "utf-8");
    const compose = yamlParse(raw) as Record<string, unknown>;
    const result = patcher(compose);
    if (!result) {
      return { name, success: true, message: "Already set in compose file" };
    }
    const output = yamlStringify(compose);
    // Validate round-trip: re-parse output to ensure it's valid YAML
    yamlParse(output);
    await copyFile(composePath, backupPath);
    await writeFile(composePath, output, "utf-8");
    return { name, success: true, message: result.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, success: false, message: `Failed to patch compose: ${msg}` };
  }
}
