/**
 * Auto-fix for doctor diagnostic issues.
 *
 * Each fixer resolves a common issue without requiring the user to understand
 * internals. Fixes are conservative — they only change what's broken.
 */

import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CONTAINER_USER, FILE_MODE_SECRET, GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";

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
};

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
  return patchCompose(deployDir, name, (content) => {
    // Add cap_drop: ALL if not present
    if (!content.includes("cap_drop")) {
      content = content.replace(
        /(services:\s*\n\s+\w+:\s*\n)/,
        "$1    cap_drop:\n      - ALL\n",
      );
      return { content, message: "Added cap_drop: [ALL] to compose" };
    }
    return null;
  });
}

/** Fix missing no-new-privileges in docker-compose.yml. */
async function fixNoNewPrivileges(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "no-new-privileges";
  return patchCompose(deployDir, name, (content) => {
    if (!content.includes("no-new-privileges")) {
      content = content.replace(
        /(services:\s*\n\s+\w+:\s*\n)/,
        "$1    security_opt:\n      - no-new-privileges\n",
      );
      return { content, message: "Added security_opt: [no-new-privileges] to compose" };
    }
    return null;
  });
}

/** Fix missing user in docker-compose.yml. */
async function fixUserUid(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "user-uid";
  const expectedUid = CONTAINER_USER.split(":")[0];
  return patchCompose(deployDir, name, (content) => {
    const uidPattern = new RegExp(`user:\\s*["']?${expectedUid}`);
    if (!uidPattern.test(content)) {
      content = content.replace(
        /(services:\s*\n\s+\w+:\s*\n)/,
        `$1    user: "${CONTAINER_USER}"\n`,
      );
      return { content, message: `Set user: "${CONTAINER_USER}" in compose` };
    }
    return null;
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function patchCompose(
  deployDir: string,
  name: DoctorCheckName,
  patcher: (content: string) => { content: string; message: string } | null,
): Promise<FixResult> {
  const composePath = join(deployDir, "engine", "docker-compose.yml");
  try {
    const content = await readFile(composePath, "utf-8");
    const result = patcher(content);
    if (!result) {
      return { name, success: true, message: "Already set in compose file" };
    }
    await writeFile(composePath, result.content, "utf-8");
    return { name, success: true, message: result.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, success: false, message: `Failed to patch compose: ${msg}` };
  }
}
