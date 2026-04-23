/**
 * Landmine validation against a CompiledWorkspace.
 *
 * Runs the 14 landmine rules directly on the compiled output — the same
 * file content that `clawhq apply` is about to write. No intermediate
 * DeploymentBundle shim: the validator reads the emitted files as they
 * exist, parses them into the typed shapes each landmine rule needs,
 * and aggregates the results.
 *
 * Wired into `apply()` so a validation error kills the deploy before
 * any file is written. The per-landmine validators themselves live in
 * src/config/validate.ts; this file is the compile-output bridge.
 */

import { parse as yamlParse } from "yaml";

import type {
  ComposeConfig,
  CronJobDefinition,
  IdentityFileInfo,
  OpenClawConfig,
  ValidationReport,
  ValidationResult,
} from "../../config/types.js";
import {
  validateLM01,
  validateLM02,
  validateLM03,
  validateLM04,
  validateLM05,
  validateLM06,
  validateLM07,
  validateLM08,
  validateLM09,
  validateLM10,
  validateLM11,
  validateLM12,
  validateLM13,
  validateLM14,
} from "../../config/validate.js";

import type { CompiledFile, CompiledWorkspace } from "./types.js";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate a compiled workspace against all 14 landmine rules.
 *
 * Parses the emitted files back into the typed shapes the per-landmine
 * validators consume. Missing files don't throw — they surface as failed
 * checks with the per-landmine severity, which is the correct signal for
 * apply to refuse the write.
 *
 * @param compiled — Output from `compile()`.
 * @param envVars — Effective env vars (compiled .env merged with any
 *   preserved credentials from the existing deploy). Used by LM-11 to
 *   check every compose ${VAR} reference resolves.
 */
export function validateCompiled(
  compiled: CompiledWorkspace,
  envVars: Record<string, string>,
): ValidationReport {
  const files = compiled.files;
  const openclawConfig = parseOpenClawConfig(files);
  const composeConfig = parseComposeConfig(files);
  const cronJobs = parseCronJobs(files);
  const identityFiles = deriveIdentityFileInfo(files);

  const results: ValidationResult[] = [
    // openclaw.json rules
    validateLM01(openclawConfig),
    validateLM02(openclawConfig),
    validateLM03(openclawConfig),
    validateLM04(openclawConfig),
    validateLM05(openclawConfig),
    // compose rules
    validateLM06(composeConfig),
    validateLM07(composeConfig),
    // cross-surface rules
    validateLM08(openclawConfig, identityFiles),
    validateLM09(cronJobs),
    validateLM10(composeConfig),
    validateLM11(composeConfig, envVars),
    validateLM12(composeConfig),
    validateLM13(composeConfig),
    validateLM14(openclawConfig),
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

// ── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Extract OpenClawConfig from engine/openclaw.json.
 *
 * Both engine/openclaw.json and top-level openclaw.json are emitted with
 * identical content by compile(); engine/ is the one mounted into the
 * container, so it's the authoritative copy for landmine checks. An
 * unparseable file is reported as an empty config so LM-01 through
 * LM-05 / LM-14 fail loudly with their existing "is not set" messages
 * rather than crashing the validator.
 */
function parseOpenClawConfig(files: readonly CompiledFile[]): OpenClawConfig {
  const file = files.find((f) => f.relativePath === "engine/openclaw.json");
  if (!file) return {};
  try {
    return JSON.parse(file.content) as OpenClawConfig;
  } catch {
    return {};
  }
}

/**
 * Extract ComposeConfig from engine/docker-compose.yml.
 *
 * Unparseable YAML → empty config; LM-06/07/10/12/13 then fail with
 * "not set" messages, which correctly surfaces a broken compose.
 */
function parseComposeConfig(files: readonly CompiledFile[]): ComposeConfig {
  const file = files.find((f) => f.relativePath === "engine/docker-compose.yml");
  if (!file) return {};
  try {
    return (yamlParse(file.content) ?? {}) as ComposeConfig;
  } catch {
    return {};
  }
}

/**
 * Extract cron job definitions from cron/jobs.json.
 *
 * OpenClaw's cron store has the shape `{ version, jobs: [...] }`. Returns
 * an empty array for a missing or malformed file — LM-09 only flags
 * jobs it can see, and a missing cron file is a separate concern.
 */
function parseCronJobs(files: readonly CompiledFile[]): readonly CronJobDefinition[] {
  const file = files.find((f) => f.relativePath === "cron/jobs.json");
  if (!file) return [];
  try {
    const parsed = JSON.parse(file.content) as { jobs?: unknown };
    return Array.isArray(parsed.jobs) ? (parsed.jobs as CronJobDefinition[]) : [];
  } catch {
    return [];
  }
}

/**
 * Derive LM-08 identity-file metadata from the compiled workspace.
 *
 * LM-08 cares only about total byte size across the bootstrap identity
 * surface — the agent's persona, heartbeat, and bootstrap docs. Content
 * hashing / per-file limits live elsewhere.
 */
function deriveIdentityFileInfo(files: readonly CompiledFile[]): readonly IdentityFileInfo[] {
  const identityRoots = new Set([
    "workspace/SOUL.md",
    "workspace/AGENTS.md",
    "workspace/USER.md",
    "workspace/TOOLS.md",
    "workspace/IDENTITY.md",
    "workspace/HEARTBEAT.md",
    "workspace/BOOTSTRAP.md",
  ]);
  const out: IdentityFileInfo[] = [];
  for (const f of files) {
    if (!identityRoots.has(f.relativePath)) continue;
    const name = f.relativePath.slice("workspace/".length);
    out.push({
      name,
      path: f.relativePath,
      sizeBytes: Buffer.byteLength(f.content, "utf-8"),
      content: f.content,
    });
  }
  return out;
}
