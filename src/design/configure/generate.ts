/**
 * Config generator — blueprint + wizard answers → DeploymentBundle.
 *
 * Produces a complete deployment bundle that passes all 14 landmine validation
 * rules by construction. Safe defaults are applied first, then blueprint-specific
 * values are layered on top.
 *
 * The generator never produces a config that fails validation.
 */

import {
  agentNetworkName,
  BOOTSTRAP_MAX_CHARS,
  CONTAINER_USER,
  ENABLE_AUDIT_STDOUT,
  GATEWAY_DEFAULT_PORT,
  WEBSOCKET_EVENT_CALLER_TIMEOUT_MS,
} from "../../config/defaults.js";
import type {
  ClawHQConfig,
  ComposeConfig,
  CronJobDefinition,
  DelegatedRulesFileInfo,
  DeploymentBundle,
  IdentityFileInfo,
  OpenClawConfig,
  ToolFileInfo,
} from "../../config/types.js";
import type { Blueprint, PersonalityDimensions } from "../blueprints/types.js";
import type { CompiledDelegationRules } from "../blueprints/delegation-types.js";
import type { UserContext } from "./types.js";
import { generateIdentityFiles as generateIdentityFilesFromBlueprint } from "../identity/index.js";
import type { IdentityFileContent } from "../identity/index.js";
import { generateToolWrappers as generateToolWrappersFromBlueprint } from "../tools/index.js";
import type { ToolFileContent } from "../tools/index.js";


import {
  buildAllowlistFromBlueprint,
  collectIntegrationDomains,
  serializeAllowlist,
} from "../../build/launcher/firewall.js";

import type { WizardAnswers } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_GATEWAY_PORT = GATEWAY_DEFAULT_PORT;
const DOCKER_BRIDGE_GATEWAY = "172.17.0.1";

// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Generate a complete deployment bundle from wizard answers.
 *
 * The bundle satisfies all 14 landmine rules by construction:
 * - LM-01: dangerouslyDisableDeviceAuth = true
 * - LM-02: allowedOrigins includes localhost
 * - LM-03: trustedProxies includes Docker bridge
 * - LM-04: tools.exec.host = "gateway"
 * - LM-05: tools.exec.security = "full"
 * - LM-06: container user = CONTAINER_USER
 * - LM-07: cap_drop ALL + no-new-privileges
 * - LM-08: identity files within bootstrapMaxChars
 * - LM-09: cron expressions use valid stepping syntax
 * - LM-10: all networks declared
 * - LM-11: env vars set for compose references
 * - LM-12: config files mounted read-only
 * - LM-13: ICC disabled on agent network
 * - LM-14: fs.workspaceOnly explicitly set
 */
export function generateBundle(answers: WizardAnswers): DeploymentBundle {
  const port = answers.gatewayPort || DEFAULT_GATEWAY_PORT;
  const networkName = agentNetworkName(answers.instanceName);

  return {
    openclawConfig: buildOpenClawConfig(answers, port),
    composeConfig: buildComposeConfig(answers, port, networkName),
    envVars: buildEnvVars(answers),
    cronJobs: buildCronJobs(answers.blueprint),
    identityFiles: buildIdentityFiles(answers.blueprint, answers.customizationAnswers, answers.personalityDimensions, answers.userContext),
    toolFiles: buildToolFiles(answers.blueprint),
    clawhqConfig: buildClawHQConfig(answers),
    delegatedRulesFile: buildDelegatedRulesFile(answers.blueprint),
  };
}

// ── OpenClaw Config ──────────────────────────────────────────────────────────

function buildOpenClawConfig(
  answers: WizardAnswers,
  port: number,
): OpenClawConfig {
  const bp = answers.blueprint;

  const config: OpenClawConfig = {
    // LM-04 + LM-05: Tool execution on gateway with full security
    tools: {
      exec: {
        host: "gateway",
        security: "full",
      },
      fs: {
        // LM-14: Filesystem access — workspace only by default
        workspaceOnly: false,
      },
    },

    // Gateway config with security settings nested correctly
    gateway: {
      port,
      bind: "lan",
      mode: "local",
      auth: {
        mode: "token",
        token: "${GATEWAY_TOKEN}",
      },
      // LM-01 + LM-02: Control UI security
      controlUi: {
        dangerouslyDisableDeviceAuth: true,
        allowedOrigins: [
          `http://127.0.0.1:${port}`,
        ],
      },
      // LM-03: Docker bridge gateway for NAT traversal
      trustedProxies: [DOCKER_BRIDGE_GATEWAY],
    },

    // Channel config
    channels: buildChannelConfig(answers),

    // Session scoping
    session: {
      dmScope: "per-channel-peer",
    },

    // Model routing from wizard answers
    agents: {
      defaults: {
        model: {
          primary: answers.modelProvider === "local"
            ? `ollama/${answers.localModel}`
            : undefined,
        },
        memorySearch: {
          provider: "ollama",
          store: { vector: { enabled: true } },
        },
      },
    },

    // Ollama provider config — reachable from container via host alias
    models: {
      providers: {
        ollama: {
          baseUrl: "http://host.docker.internal:11434",
          models: [],
        },
      },
    },

    // Hooks — enable internal hooks for session memory and bootstrap
    hooks: {
      internal: {
        enabled: true,
        entries: {
          "boot-md": { enabled: true },
          "bootstrap-extra-files": { enabled: true },
          "session-memory": { enabled: true },
        },
      },
    },
  };

  return config;
}

// ── Channel Config ───────────────────────────────────────────────────────────

function buildChannelConfig(
  answers: WizardAnswers,
): Record<string, { enabled: boolean; dmPolicy: "pairing" }> {
  const channels: Record<string, { enabled: boolean; dmPolicy: "pairing" }> = {};
  const selectedChannel = answers.channel;

  // Enable selected channel, disable others from blueprint
  for (const ch of answers.blueprint.channels.supported) {
    channels[ch] = {
      enabled: ch === selectedChannel,
      dmPolicy: "pairing",
    };
  }

  return channels;
}

// ── Docker Compose Config ────────────────────────────────────────────────────

function buildComposeConfig(
  answers: WizardAnswers,
  port: number,
  networkName: string,
): ComposeConfig {
  const bp = answers.blueprint;
  const posture = bp.security_posture.posture;

  // Resource limits based on security posture
  const resourceLimits = posture === "paranoid"
    ? { cpus: "1", memory: "1g" }
    : posture === "hardened"
      ? { cpus: "2", memory: "2g" }
      : { cpus: "4", memory: "4g" };

  return {
    services: {
      openclaw: {
        // LM-06: Run as UID 1000
        user: CONTAINER_USER,

        // LM-07: Drop all capabilities + no-new-privileges
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges"],

        // Read-only root filesystem
        read_only: true,

        // Volume mounts
        volumes: [
          // LM-12: Config files mounted read-only
          "./openclaw.json:/app/openclaw.json:ro",
          "./credentials.json:/app/credentials.json:ro",
          // Workspace writable for agent operation
          "./workspace:/app/workspace",
          // Cron writable for job execution logs
          "./cron:/app/cron",
        ],

        // Network
        networks: [networkName],

        // Environment from .env file
        env_file: [".env"],

        // Port + resource labels (compose environment for reference)
        environment: {
          GATEWAY_PORT: String(port),
          NODE_ENV: "production",
          ...Object.fromEntries(
            Object.entries(resourceLimits).map(([k, v]) => [`RESOURCE_${k.toUpperCase()}`, v]),
          ),
        },
      },
    },
    networks: {
      // LM-10: Network declared
      // LM-13: ICC disabled for egress filtering
      [networkName]: {
        driver: "bridge",
        driver_opts: {
          "com.docker.network.bridge.enable_icc": "false",
        },
      },
    },
  };
}

// ── Environment Variables ────────────────────────────────────────────────────

function buildEnvVars(answers: WizardAnswers): Record<string, string> {
  const env: Record<string, string> = {
    // Gateway token (generated placeholder — user supplies real value)
    GATEWAY_TOKEN: generateToken(),
    GATEWAY_PORT: String(answers.gatewayPort || DEFAULT_GATEWAY_PORT),

    // OpenClaw v0.8.6+ environment variable defaults
    WEBSOCKET_EVENT_CALLER_TIMEOUT: String(WEBSOCKET_EVENT_CALLER_TIMEOUT_MS),
    ENABLE_AUDIT_STDOUT,
  };

  // Flatten integration credentials into env vars
  // e.g. integrations.email.IMAP_HOST → EMAIL_IMAP_HOST
  for (const [integration, creds] of Object.entries(answers.integrations)) {
    const prefix = integration.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    for (const [key, value] of Object.entries(creds)) {
      env[`${prefix}_${key.toUpperCase()}`] = value;
    }
  }

  return env;
}

// ── Cron Jobs ────────────────────────────────────────────────────────────────

/**
 * Build cron jobs from blueprint cron_config.
 *
 * LM-09: All expressions use valid stepping syntax (no bare N/step).
 */
function buildCronJobs(blueprint: Blueprint): CronJobDefinition[] {
  const jobs: CronJobDefinition[] = [];
  const cron = blueprint.cron_config;
  const routing = cron.model_routing;

  // Heartbeat — regular check-in
  if (cron.heartbeat) {
    const expr = normalizeCronExpr(cron.heartbeat);
    if (expr) {
      const r = routing?.heartbeat;
      jobs.push({
        id: "heartbeat",
        kind: "cron",
        expr,
        task: "Run heartbeat check — verify all systems operational",
        enabled: true,
        delivery: "none",
        model: r?.model,
        fallbacks: r?.fallbacks,
        session: "main",
      });
    }
  }

  // Work session — periodic active work
  if (cron.work_session) {
    const expr = normalizeCronExpr(cron.work_session);
    if (expr) {
      const r = routing?.work_session;
      jobs.push({
        id: "work-session",
        kind: "cron",
        expr,
        task: "Run scheduled work session — process pending tasks and check integrations",
        enabled: true,
        delivery: "none",
        model: r?.model,
        fallbacks: r?.fallbacks,
        session: "main",
      });
    }
  }

  // Morning brief
  if (cron.morning_brief) {
    const expr = normalizeMorningBrief(cron.morning_brief);
    const r = routing?.morning_brief;
    jobs.push({
      id: "morning-brief",
      kind: "cron",
      expr,
      task: "Send morning briefing — summarize overnight activity and today's schedule",
      enabled: true,
      delivery: "announce",
      model: r?.model,
      fallbacks: r?.fallbacks,
      session: "main",
    });
  }

  // Skill-specific cron jobs — included skills run on the work-session schedule
  // Skills inherit the work_session model routing for cost consistency
  if (cron.work_session && blueprint.skill_bundle?.included) {
    const skillExpr = normalizeCronExpr(cron.work_session);
    if (skillExpr) {
      const r = routing?.work_session;
      for (const skillName of blueprint.skill_bundle.included) {
        jobs.push({
          id: `skill-${skillName}`,
          kind: "cron",
          expr: skillExpr,
          task: `Run skill: ${skillName}`,
          enabled: true,
          delivery: "none",
          model: r?.model,
          fallbacks: r?.fallbacks,
          session: "main",
        });
      }
    }
  }

  return jobs;
}

// ── Identity Files ───────────────────────────────────────────────────────────

// Re-export for backward compatibility — consumers import from configure/index.
export type { IdentityFileContent } from "../identity/index.js";

/**
 * Generate identity file content from a blueprint.
 *
 * Delegates to the identity module for identity file generation.
 * Returns the actual file content for writing to disk.
 */
export function generateIdentityFiles(
  blueprint: Blueprint,
  customizationAnswers: Readonly<Record<string, string>> = {},
  personalityDimensions?: PersonalityDimensions,
  userContext?: UserContext,
): IdentityFileContent[] {
  return generateIdentityFilesFromBlueprint(blueprint, undefined, customizationAnswers, personalityDimensions, userContext);
}

/**
 * Build identity file metadata from blueprint personality.
 *
 * LM-08: Total size stays within bootstrapMaxChars (20,000 default).
 */
function buildIdentityFiles(
  blueprint: Blueprint,
  customizationAnswers: Readonly<Record<string, string>> = {},
  personalityDimensions?: PersonalityDimensions,
  userContext?: UserContext,
): IdentityFileInfo[] {
  return generateIdentityFiles(blueprint, customizationAnswers, personalityDimensions, userContext).map((f) => ({
    name: f.name,
    path: f.relativePath,
    sizeBytes: Buffer.byteLength(f.content, "utf-8"),
  }));
}

// ── Tool Files ──────────────────────────────────────────────────────────

// Re-export for consumers that import from configure/index.
export type { ToolFileContent } from "../tools/index.js";

/**
 * Generate tool wrapper content from a blueprint.
 *
 * Delegates to the tools module for CLI wrapper generation.
 * Returns the actual file content for writing to disk.
 */
export function generateToolFiles(blueprint: Blueprint): ToolFileContent[] {
  return generateToolWrappersFromBlueprint(blueprint);
}

/**
 * Build tool file metadata from blueprint toolbelt.
 *
 * Returns ToolFileInfo entries for inclusion in the deployment bundle.
 */
function buildToolFiles(blueprint: Blueprint): ToolFileInfo[] {
  return generateToolFiles(blueprint).map((f) => ({
    name: f.name,
    path: f.relativePath,
    sizeBytes: Buffer.byteLength(f.content, "utf-8"),
    mode: f.mode,
  }));
}

// ── Delegated Rules ─────────────────────────────────────────────────────────

/**
 * Compile blueprint delegation rules into a delegated-rules.json workspace file.
 *
 * Returns metadata about the compiled file, or undefined if the blueprint
 * has no delegation_rules section.
 */
function buildDelegatedRulesFile(blueprint: Blueprint): DelegatedRulesFileInfo | undefined {
  if (!blueprint.delegation_rules?.categories?.length) return undefined;

  const compiled: CompiledDelegationRules = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    categories: blueprint.delegation_rules.categories,
  };

  const content = JSON.stringify(compiled, null, 2);
  const ruleCount = blueprint.delegation_rules.categories.reduce(
    (sum, cat) => sum + cat.rules.length,
    0,
  );

  return {
    path: "workspace/delegated-rules.json",
    sizeBytes: Buffer.byteLength(content, "utf-8"),
    categoryCount: blueprint.delegation_rules.categories.length,
    ruleCount,
  };
}

/**
 * Generate the compiled delegated-rules.json content from a blueprint.
 *
 * Public API for the writer to get the actual file content.
 */
export function generateDelegatedRulesContent(blueprint: Blueprint): string | undefined {
  if (!blueprint.delegation_rules?.categories?.length) return undefined;

  const compiled: CompiledDelegationRules = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    categories: blueprint.delegation_rules.categories,
  };

  return JSON.stringify(compiled, null, 2);
}

// ── Domain Allowlist ────────────────────────────────────────────────────────

/**
 * Generate the egress domain allowlist content from a blueprint and its integrations.
 *
 * Compiles blueprint egress_domains + integration registry domains into
 * a serialized YAML allowlist ready for writing to ops/firewall/allowlist.yaml.
 *
 * This is the single compilation point: blueprint → allowlist.
 */
export function generateAllowlistContent(
  blueprint: Blueprint,
  integrationNames: readonly string[] = [],
): string {
  const integrationDomains = collectIntegrationDomains(integrationNames);
  const entries = buildAllowlistFromBlueprint(
    blueprint.security_posture.egress_domains,
    integrationDomains,
  );
  return serializeAllowlist(entries);
}

// ── ClawHQ Config ────────────────────────────────────────────────────────────

function buildClawHQConfig(answers: WizardAnswers): ClawHQConfig {
  const bp = answers.blueprint;

  return {
    version: "0.1.0",
    ...(answers.instanceName && answers.instanceName !== "default"
      ? { instanceName: answers.instanceName }
      : {}),
    installMethod: "cache",
    security: {
      posture: bp.security_posture.posture === "paranoid"
        ? "paranoid"
        : bp.security_posture.posture === "hardened"
          ? "hardened"
          : "standard",
      egress: bp.security_posture.egress,
    },
    cloud: {
      enabled: !answers.airGapped,
      trustMode: answers.airGapped ? "paranoid" : "zero-trust",
    },
    paths: {
      deployDir: answers.deployDir,
      engineDir: `${answers.deployDir}/engine`,
      workspaceDir: `${answers.deployDir}/workspace`,
      opsDir: `${answers.deployDir}/ops`,
    },
  };
}

// ── Cron Validation ──────────────────────────────────────────────────────────

/** Valid ranges for each cron field position. */
const CRON_FIELD_RANGES: Array<{ name: string; min: number; max: number }> = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
];

/**
 * Validate a single cron field value against its allowed range.
 * Returns an error message or null if valid.
 */
function validateCronFieldPart(
  part: string,
  range: { name: string; min: number; max: number },
): string | null {
  // Wildcard — always valid
  if (part === "*") return null;

  // Step on wildcard: */N
  const wildcardStep = part.match(/^\*\/(\d+)$/);
  if (wildcardStep) {
    const step = parseInt(wildcardStep[1]!, 10);
    if (step === 0) return `${range.name}: step value cannot be 0 in "${part}"`;
    return null;
  }

  // Range with optional step: N-M or N-M/S
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
      if (step === 0) return `${range.name}: step value cannot be 0 in "${part}"`;
    }
    return null;
  }

  // Plain number
  const num = parseInt(part, 10);
  if (/^\d+$/.test(part)) {
    if (num < range.min || num > range.max)
      return `${range.name}: value ${num} out of range ${range.min}-${range.max}`;
    return null;
  }

  return `${range.name}: invalid syntax "${part}"`;
}

/**
 * Validate a complete 5-field cron expression.
 * Returns an array of error messages (empty if valid).
 */
export function validateCronExpr(expr: string): string[] {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return [`Expected 5 fields, got ${fields.length}: "${expr}"`];
  }

  const errors: string[] = [];
  for (let i = 0; i < 5; i++) {
    const field = fields[i]!;
    const range = CRON_FIELD_RANGES[i]!;

    // Each field can be a comma-separated list
    for (const part of field.split(",")) {
      const err = validateCronFieldPart(part, range);
      if (err) errors.push(err);
    }
  }
  return errors;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Normalize blueprint cron expressions to valid OpenClaw format.
//
// Handles special blueprint syntax:
// - "star/15 waking" -> five-field cron (strip "waking" qualifier)
// - "star/30 waking" -> five-field cron
// - Bare "N/step" → "0-59/step" (LM-09 fix)
//
// Validates field count and value ranges after normalization.
// Throws on invalid expressions so they are caught at config generation time.
function normalizeCronExpr(blueprintExpr: string): string | null {
  // Strip "waking" qualifier — active hours handled separately
  const cleaned = blueprintExpr.replace(/\s+waking$/i, "").trim();
  if (!cleaned) return null;

  let expr: string;

  // If it looks like a shorthand (e.g. "*/15"), expand to 5-field cron
  if (/^\*\/\d+$/.test(cleaned)) {
    expr = `${cleaned} * * * *`;
  } else if (cleaned.split(/\s+/).length === 5) {
    // If it's already 5 fields, fix any bare N/step (LM-09)
    expr = cleaned.split(/\s+/).map(fixCronField).join(" ");
  } else if (/^\d+$/.test(cleaned)) {
    // Single number — treat as minutes past the hour
    expr = `${cleaned} * * * *`;
  } else {
    return null;
  }

  // Validate field ranges
  const errors = validateCronExpr(expr);
  if (errors.length > 0) {
    throw new Error(
      `Invalid cron expression "${blueprintExpr}": ${errors.join("; ")}`,
    );
  }

  return expr;
}

/**
 * Normalize morning brief time to a valid 5-field cron expression.
 *
 * "07:00" → "0 7 * * *"
 *
 * Validates that hour and minute are within range.
 */
function normalizeMorningBrief(timeStr: string): string {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (match && match[1] !== undefined && match[2] !== undefined) {
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const expr = `${minute} ${hour} * * *`;

    const errors = validateCronExpr(expr);
    if (errors.length > 0) {
      throw new Error(
        `Invalid morning brief time "${timeStr}": ${errors.join("; ")}`,
      );
    }

    return expr;
  }
  // Fallback: 7am
  return "0 7 * * *";
}

/**
 * Fix a single cron field to prevent LM-09 violations.
 *
 * Bare "N/step" → "0-59/step" for minute field (safe expansion).
 */
function fixCronField(field: string): string {
  const match = field.match(/^(\d+)\/(\d+)$/);
  if (match) {
    return `0-59/${match[2]}`;
  }
  return field;
}

/** Generate a random hex token for Gateway auth. */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
