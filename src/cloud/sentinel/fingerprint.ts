/**
 * Config fingerprint generator — privacy-safe config representation.
 *
 * Extracts structural metadata from a user's OpenClaw config without
 * exposing any values, credentials, or content. The fingerprint tells
 * Sentinel what config keys are in use so it can predict whether an
 * upstream change would cause breakage.
 *
 * What IS included: key names, tool names, channel types, counts.
 * What is NEVER included: values, tokens, passwords, identity content.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEPLOY_ENGINE_OPENCLAW_JSON,
  DEPLOY_ENGINE_SUBDIR,
} from "../../config/paths.js";
import type { OpenClawConfig } from "../../config/types.js";
import {
  validateLM01,
  validateLM02,
  validateLM03,
  validateLM04,
  validateLM05,
  validateLM14,
} from "../../config/validate.js";

import type { ConfigFingerprint } from "./types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Compute stable agent ID from deploy directory (same as heartbeat). */
function computeAgentId(deployDir: string): string {
  return createHash("sha256").update(deployDir).digest("hex").slice(0, 16);
}

/** Extract top-level keys from an object, sorted alphabetically. */
function topLevelKeys(obj: Record<string, unknown>): readonly string[] {
  return Object.keys(obj).sort();
}

/** Extract tool names from the config. */
function extractToolNames(config: OpenClawConfig): readonly string[] {
  const tools: string[] = [];
  if (config.tools) {
    if (config.tools.allow) {
      tools.push(...config.tools.allow);
    }
    if (config.tools.profile) {
      tools.push(`profile:${config.tools.profile}`);
    }
  }
  return tools.sort();
}

/** Extract channel type names (not values or credentials). */
function extractChannelTypes(config: OpenClawConfig): readonly string[] {
  if (!config.channels) return [];
  return Object.keys(config.channels).sort();
}

/** Count cron jobs from a cron/jobs.json file if it exists. */
function countCronJobs(deployDir: string): number {
  const cronPath = join(deployDir, DEPLOY_ENGINE_SUBDIR, "cron", "jobs.json");
  if (!existsSync(cronPath)) return 0;
  try {
    const raw = readFileSync(cronPath, "utf-8");
    const jobs = JSON.parse(raw) as unknown[];
    return Array.isArray(jobs) ? jobs.length : 0;
  } catch {
    return 0;
  }
}

/** Detect OpenClaw version from package.json or version file. */
function detectOpenClawVersion(deployDir: string): string {
  // Try engine/package.json first
  const pkgPath = join(deployDir, DEPLOY_ENGINE_SUBDIR, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(raw) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // Fall through
    }
  }
  // Try VERSION file
  const versionPath = join(deployDir, DEPLOY_ENGINE_SUBDIR, "VERSION");
  if (existsSync(versionPath)) {
    try {
      return readFileSync(versionPath, "utf-8").trim();
    } catch {
      // Fall through
    }
  }
  return "unknown";
}

/**
 * Run the landmine validators that accept OpenClawConfig directly.
 *
 * LM-06 through LM-13 require ComposeConfig, identity files, or cron jobs —
 * those are not available from the config alone. We validate what we can.
 */
function runLandmineValidation(config: OpenClawConfig): readonly string[] {
  const validators = [
    validateLM01, validateLM02, validateLM03, validateLM04,
    validateLM05, validateLM14,
  ];
  const passed: string[] = [];
  for (const validate of validators) {
    try {
      const result = validate(config);
      if (result.passed) {
        passed.push(result.rule);
      }
    } catch {
      // Validator failed — skip
    }
  }
  return passed;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a privacy-safe config fingerprint from a deployment directory.
 *
 * Reads the OpenClaw config and extracts structural metadata only.
 * Never includes values, credentials, or content.
 */
export function generateFingerprint(
  deployDir: string,
  blueprintId?: string,
): ConfigFingerprint {
  const configPath = join(deployDir, DEPLOY_ENGINE_SUBDIR, DEPLOY_ENGINE_OPENCLAW_JSON);

  let config: OpenClawConfig = {};
  let configLoadFailed = false;
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      config = JSON.parse(raw) as OpenClawConfig;
    } catch {
      configLoadFailed = true;
    }
  }

  return {
    agentId: computeAgentId(deployDir),
    openclawVersion: detectOpenClawVersion(deployDir),
    blueprintId,
    configKeysSet: topLevelKeys(config as Record<string, unknown>),
    toolsEnabled: extractToolNames(config),
    channelsConfigured: extractChannelTypes(config),
    cronJobCount: countCronJobs(deployDir),
    hasIdentityConfig: config.identity !== undefined,
    hasGatewayConfig: config.gateway !== undefined,
    hasAgentsConfig: config.agents !== undefined,
    landminesPassed: runLandmineValidation(config),
    configLoadFailed,
    generatedAt: new Date().toISOString(),
  };
}
