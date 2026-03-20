/**
 * Config generator — blueprint + wizard answers → DeploymentBundle.
 *
 * Produces a complete deployment bundle that passes all 14 landmine validation
 * rules by construction. Safe defaults are applied first, then blueprint-specific
 * values are layered on top.
 *
 * The generator never produces a config that fails validation.
 */

import { BOOTSTRAP_MAX_CHARS, GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import type {
  ClawHQConfig,
  ComposeConfig,
  CronJobDefinition,
  DeploymentBundle,
  IdentityFileInfo,
  OpenClawConfig,
  ToolFileInfo,
} from "../../config/types.js";
import type { Blueprint } from "../blueprints/types.js";
import { generateIdentityFiles as generateIdentityFilesFromBlueprint } from "../identity/index.js";
import type { IdentityFileContent } from "../identity/index.js";
import { generateToolWrappers as generateToolWrappersFromBlueprint } from "../tools/index.js";
import type { ToolFileContent } from "../tools/index.js";


import type { WizardAnswers } from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_GATEWAY_PORT = GATEWAY_DEFAULT_PORT;
const DOCKER_BRIDGE_GATEWAY = "172.17.0.1";
const CONTAINER_USER = "1000:1000";
const AGENT_NETWORK = "clawhq_net";

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
 * - LM-06: container user = 1000:1000
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

  return {
    openclawConfig: buildOpenClawConfig(answers, port),
    composeConfig: buildComposeConfig(answers, port),
    envVars: buildEnvVars(answers),
    cronJobs: buildCronJobs(answers.blueprint),
    identityFiles: buildIdentityFiles(answers.blueprint, answers.customizationAnswers),
    toolFiles: buildToolFiles(answers.blueprint),
    clawhqConfig: buildClawHQConfig(answers),
  };
}

// ── OpenClaw Config ──────────────────────────────────────────────────────────

function buildOpenClawConfig(
  answers: WizardAnswers,
  port: number,
): OpenClawConfig {
  const bp = answers.blueprint;

  const config: OpenClawConfig = {
    // LM-01: Disable device auth to prevent signature loop
    dangerouslyDisableDeviceAuth: true,

    // LM-02: CORS origins for control UI
    allowedOrigins: [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
    ],

    // LM-03: Docker bridge gateway for NAT traversal
    trustedProxies: [DOCKER_BRIDGE_GATEWAY],

    // LM-04 + LM-05: Tool execution on gateway with full security
    tools: {
      exec: {
        host: "gateway",
        security: "full",
      },
    },

    // LM-14: Filesystem access — workspace only by default
    fs: {
      workspaceOnly: true,
    },

    // Gateway config
    gateway: {
      port,
      bind: "0.0.0.0",
      auth: {
        token: "${GATEWAY_TOKEN}",
      },
      reload: {
        mode: "hybrid",
      },
    },

    // Cron enabled for blueprint-defined jobs
    cron: {
      enabled: true,
      maxConcurrentRuns: 2,
    },

    // Identity from blueprint
    identity: {
      name: bp.name,
      bootstrapMaxChars: BOOTSTRAP_MAX_CHARS,
    },

    // Channel config
    channels: buildChannelConfig(answers),

    // Session scoping
    session: {
      dmScope: "per-peer",
    },

    // Model routing from wizard answers
    agents: {
      defaults: {
        model: {
          primary: answers.modelProvider === "local"
            ? answers.localModel
            : undefined,
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
        networks: [AGENT_NETWORK],

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
      [AGENT_NETWORK]: {
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

  // Heartbeat — regular check-in
  if (cron.heartbeat) {
    const expr = normalizeCronExpr(cron.heartbeat);
    if (expr) {
      jobs.push({
        id: "heartbeat",
        kind: "cron",
        expr,
        task: "Run heartbeat check — verify all systems operational",
        enabled: true,
        delivery: "none",
        session: "main",
      });
    }
  }

  // Work session — periodic active work
  if (cron.work_session) {
    const expr = normalizeCronExpr(cron.work_session);
    if (expr) {
      jobs.push({
        id: "work-session",
        kind: "cron",
        expr,
        task: "Run scheduled work session — process pending tasks and check integrations",
        enabled: true,
        delivery: "none",
        session: "main",
      });
    }
  }

  // Morning brief
  if (cron.morning_brief) {
    const expr = normalizeMorningBrief(cron.morning_brief);
    jobs.push({
      id: "morning-brief",
      kind: "cron",
      expr,
      task: "Send morning briefing — summarize overnight activity and today's schedule",
      enabled: true,
      delivery: "announce",
      session: "main",
    });
  }

  // Skill-specific cron jobs — included skills run on the work-session schedule
  if (cron.work_session && blueprint.skill_bundle?.included) {
    const skillExpr = normalizeCronExpr(cron.work_session);
    if (skillExpr) {
      for (const skillName of blueprint.skill_bundle.included) {
        jobs.push({
          id: `skill-${skillName}`,
          kind: "cron",
          expr: skillExpr,
          task: `Run skill: ${skillName}`,
          enabled: true,
          delivery: "none",
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
 * Delegates to the identity module for SOUL.md and AGENTS.md generation.
 * Returns the actual file content for writing to disk.
 */
export function generateIdentityFiles(
  blueprint: Blueprint,
  customizationAnswers: Readonly<Record<string, string>> = {},
): IdentityFileContent[] {
  return generateIdentityFilesFromBlueprint(blueprint, undefined, customizationAnswers);
}

/**
 * Build identity file metadata from blueprint personality.
 *
 * LM-08: Total size stays within bootstrapMaxChars (20,000 default).
 */
function buildIdentityFiles(
  blueprint: Blueprint,
  customizationAnswers: Readonly<Record<string, string>> = {},
): IdentityFileInfo[] {
  return generateIdentityFiles(blueprint, customizationAnswers).map((f) => ({
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

// ── ClawHQ Config ────────────────────────────────────────────────────────────

function buildClawHQConfig(answers: WizardAnswers): ClawHQConfig {
  const bp = answers.blueprint;

  return {
    version: "0.1.0",
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

// ── Helpers ──────────────────────────────────────────────────────────────────

// Normalize blueprint cron expressions to valid OpenClaw format.
//
// Handles special blueprint syntax:
// - "star/15 waking" -> five-field cron (strip "waking" qualifier)
// - "star/30 waking" -> five-field cron
// - Bare "N/step" → "0-59/step" (LM-09 fix)
function normalizeCronExpr(blueprintExpr: string): string | null {
  // Strip "waking" qualifier — active hours handled separately
  const cleaned = blueprintExpr.replace(/\s+waking$/i, "").trim();
  if (!cleaned) return null;

  // If it looks like a shorthand (e.g. "*/15"), expand to 5-field cron
  if (/^\*\/\d+$/.test(cleaned)) {
    return `${cleaned} * * * *`;
  }

  // If it's already 5 fields, fix any bare N/step (LM-09)
  const fields = cleaned.split(/\s+/);
  if (fields.length === 5) {
    return fields.map(fixCronField).join(" ");
  }

  // Single number — treat as minutes past the hour
  if (/^\d+$/.test(cleaned)) {
    return `${cleaned} * * * *`;
  }

  return null;
}

/**
 * Normalize morning brief time to a valid 5-field cron expression.
 *
 * "07:00" → "0 7 * * *"
 */
function normalizeMorningBrief(timeStr: string): string {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (match && match[1] !== undefined && match[2] !== undefined) {
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    return `${minute} ${hour} * * *`;
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
