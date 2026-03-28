/**
 * Auto-fix for doctor diagnostic issues.
 *
 * Each fixer resolves a common issue without requiring the user to understand
 * internals. Fixes are conservative — they only change what's broken.
 */

import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseDocument, stringify as yamlStringify } from "yaml";

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
  "tool-access-grants": fixToolAccessGrants,
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
  return patchComposeYaml(deployDir, name, (doc) => {
    const services = doc.get("services") as Record<string, unknown> | null;
    if (!services) return null;
    const serviceNames = Object.keys(services);
    if (serviceNames.length === 0) return null;

    let changed = false;
    for (const svcName of serviceNames) {
      const svc = doc.getIn(["services", svcName]);
      if (!svc) continue;
      const capDrop = doc.getIn(["services", svcName, "cap_drop"]);
      const capDropArr = Array.isArray(capDrop) ? capDrop : [];
      if (!capDropArr.some((c: unknown) => String(c).toUpperCase() === "ALL")) {
        doc.setIn(["services", svcName, "cap_drop"], ["ALL"]);
        changed = true;
      }
    }
    return changed ? "Added cap_drop: [ALL] to all services in compose" : null;
  });
}

/** Fix missing no-new-privileges in docker-compose.yml. */
async function fixNoNewPrivileges(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "no-new-privileges";
  return patchComposeYaml(deployDir, name, (doc) => {
    const services = doc.get("services") as Record<string, unknown> | null;
    if (!services) return null;
    const serviceNames = Object.keys(services);
    if (serviceNames.length === 0) return null;

    let changed = false;
    for (const svcName of serviceNames) {
      const svc = doc.getIn(["services", svcName]);
      if (!svc) continue;
      const secOpt = doc.getIn(["services", svcName, "security_opt"]);
      const secOptArr = Array.isArray(secOpt) ? secOpt : [];
      const hasNoNewPriv = secOptArr.some(
        (o: unknown) => o === "no-new-privileges" || o === "no-new-privileges:true",
      );
      if (!hasNoNewPriv) {
        doc.setIn(["services", svcName, "security_opt"], ["no-new-privileges"]);
        changed = true;
      }
    }
    return changed ? "Added security_opt: [no-new-privileges] to all services in compose" : null;
  });
}

/** Fix missing user in docker-compose.yml. */
async function fixUserUid(deployDir: string): Promise<FixResult> {
  const name: DoctorCheckName = "user-uid";
  const expectedUid = CONTAINER_USER.split(":")[0];
  return patchComposeYaml(deployDir, name, (doc) => {
    const services = doc.get("services") as Record<string, unknown> | null;
    if (!services) return null;
    const serviceNames = Object.keys(services);
    if (serviceNames.length === 0) return null;

    let changed = false;
    for (const svcName of serviceNames) {
      const svc = doc.getIn(["services", svcName]);
      if (!svc) continue;
      const user = doc.getIn(["services", svcName, "user"]);
      const userStr = user != null ? String(user) : "";
      if (userStr !== CONTAINER_USER && userStr !== expectedUid) {
        doc.setIn(["services", svcName, "user"], CONTAINER_USER);
        changed = true;
      }
    }
    return changed ? `Set user: "${CONTAINER_USER}" in all services in compose` : null;
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

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse docker-compose.yml with a proper YAML parser, apply a structural
 * patch, and write the result back. Using a parser instead of regex avoids
 * fragile pattern-matching against arbitrary indentation and quoting styles.
 *
 * @param patcher - Receives the parsed YAML Document, mutates it in place,
 *   and returns a human-readable message if a change was made, or null if
 *   the value was already correct (no write needed).
 */
async function patchComposeYaml(
  deployDir: string,
  name: DoctorCheckName,
  patcher: (doc: ReturnType<typeof parseDocument>) => string | null,
): Promise<FixResult> {
  const composePath = join(deployDir, "engine", "docker-compose.yml");
  try {
    const raw = await readFile(composePath, "utf-8");
    const doc = parseDocument(raw);
    const message = patcher(doc);
    if (!message) {
      return { name, success: true, message: "Already set in compose file" };
    }
    await writeFile(composePath, yamlStringify(doc), "utf-8");
    return { name, success: true, message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, success: false, message: `Failed to patch compose: ${msg}` };
  }
}
