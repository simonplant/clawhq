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
  CRED_PROXY_PORT,
  ENABLE_AUDIT_STDOUT,
  GATEWAY_DEFAULT_PORT,
  WEBSOCKET_EVENT_CALLER_TIMEOUT_MS,
} from "../../config/defaults.js";
import type {
  ActiveHours,
  ChannelConfig,
  ClawHQConfig,
  ComposeConfig,
  CronJobDefinition,
  DelegatedRulesFileInfo,
  DeploymentBundle,
  ExecAsk,
  IdentityFileInfo,
  OpenClawConfig,
  SkillFileInfo,
  ToolFileInfo,
} from "../../config/types.js";
import type { Blueprint, PersonalityDimensions } from "../blueprints/types.js";
import { isValidProfileId, mergeProfileDeny, MISSION_PROFILE_DEFAULTS } from "../blueprints/profiles.js";
import type { CompiledDelegationRules } from "../blueprints/delegation-types.js";
import type { UserContext } from "./types.js";
import { generateIdentityFiles as generateIdentityFilesFromBlueprint } from "../identity/index.js";
import type { IdentityFileContent } from "../identity/index.js";
import { generateToolWrappers as generateToolWrappersFromBlueprint } from "../tools/index.js";
import type { ToolFileContent } from "../tools/index.js";
import { loadBlueprintSkills, loadPlatformSkills } from "../skills/index.js";
import type { SkillFileEntry } from "../skills/index.js";

import {
  buildAllowlistFromBlueprint,
  collectIntegrationDomains,
  serializeAllowlist,
} from "../../build/launcher/firewall.js";

import { BUILTIN_ROUTES, CRED_PROXY_SERVICE_NAME, filterRoutesForEnv, buildRoutesConfig } from "../../secure/credentials/proxy-routes.js";
import { generateProxyServerScript } from "../../secure/credentials/proxy-server.js";
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
  const envVars = buildEnvVars(answers);

  // Auto-detect proxy: enabled when any integration env vars match builtin routes
  const activeRoutes = filterRoutesForEnv(BUILTIN_ROUTES, envVars);
  const proxyEnabled = activeRoutes.length > 0;

  // If proxy enabled, add CRED_PROXY_URL to env vars so tools use it
  if (proxyEnabled) {
    envVars.CRED_PROXY_URL = `http://${CRED_PROXY_SERVICE_NAME}:${CRED_PROXY_PORT}`;
    envVars.CRED_PROXY_PORT = String(CRED_PROXY_PORT);
  }

  return {
    openclawConfig: buildOpenClawConfig(answers, port),
    composeConfig: buildComposeConfig(answers, port, networkName),
    envVars,
    cronJobs: buildCronJobs(answers.blueprint, answers.userContext?.timezone),
    identityFiles: buildIdentityFiles(answers.blueprint, answers.customizationAnswers, answers.personalityDimensions, answers.userContext),
    toolFiles: buildToolFiles(answers.blueprint),
    skillFiles: buildSkillFiles(answers.blueprint),
    clawhqConfig: buildClawHQConfig(answers),
    delegatedRulesFile: buildDelegatedRulesFile(answers.blueprint),
    ...(proxyEnabled ? {
      proxyServerScript: generateProxyServerScript(),
      proxyRoutesConfig: JSON.stringify(buildRoutesConfig(activeRoutes), null, 2),
    } : {}),
  };
}

// ── OpenClaw Config ──────────────────────────────────────────────────────────

function buildOpenClawConfig(
  answers: WizardAnswers,
  port: number,
): OpenClawConfig {
  const bp = answers.blueprint;

  // Posture-driven exec.ask: hardened/under-attack → 'off' (container IS the boundary per AD-05)
  const execAsk: ExecAsk = bp.security_posture.posture === "hardened" || bp.security_posture.posture === "under-attack"
    ? "off"
    : "auto";

  // Profile-driven tool deny list — merge profile defaults with blueprint overrides
  const profileDeny = bp.profile_ref && isValidProfileId(bp.profile_ref)
    ? MISSION_PROFILE_DEFAULTS[bp.profile_ref].deny
    : [];
  const blueprintDeny = bp.toolbelt.deny ?? [];
  const blueprintAllow = bp.toolbelt.allow ?? [];
  const mergedDeny = mergeProfileDeny(profileDeny, blueprintDeny, blueprintAllow);

  const config: OpenClawConfig = {
    // LM-04 + LM-05: Tool execution on gateway with full security
    tools: {
      exec: {
        host: "gateway",
        security: "full",
        ask: execAsk,
      },
      // Profile-driven deny list (empty array omitted for cleanliness)
      ...(mergedDeny.length > 0 ? { deny: mergedDeny } : {}),
      fs: {
        // LM-14: Filesystem access — workspace only by default
        workspaceOnly: true,
      },
    },

    // Gateway config with security settings nested correctly
    gateway: {
      port,
      bind: "lan",
      mode: "local",
      auth: {
        mode: "token",
        token: "${OPENCLAW_GATEWAY_TOKEN}",
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

    // Auth profiles for model providers
    ...(answers.auth?.provider ? {
      auth: {
        profiles: {
          [`${answers.auth.provider}:default`]: {
            provider: answers.auth.provider,
            mode: "token",
          },
        },
      },
    } : {}),

    // Pre-declare plugins so OpenClaw doesn't auto-enable and rewrite the config.
    // Without this, OpenClaw detects the ollama model on startup, adds plugins,
    // which triggers the config watcher → gateway restart loop every ~12 minutes.
    plugins: {
      entries: {
        ...(answers.modelProvider === "local" ? { ollama: { enabled: true } } : {}),
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
): OpenClawConfig["channels"] {
  const channels: Record<string, ChannelConfig & Record<string, unknown>> = {};
  const selectedChannel = answers.channel;

  // Enable selected channel, disable others from blueprint
  for (const ch of answers.blueprint.channels.supported) {
    const channelConf: ChannelConfig & Record<string, unknown> = {
      enabled: ch === selectedChannel,
      dmPolicy: "pairing" as const,
    };

    // Merge channel-specific config (bot tokens, etc.) from config file
    const extra = answers.channelConfig?.[ch];
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        channelConf[key] = value;
      }
    }

    channels[ch] = channelConf;
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

  // Resource limits — same across postures, security is controls not starvation
  const resourceLimits = { cpus: "4", memory: "4g" };

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
    // Gateway token — OpenClaw expects OPENCLAW_GATEWAY_TOKEN
    OPENCLAW_GATEWAY_TOKEN: generateToken(),
    GATEWAY_PORT: String(answers.gatewayPort || DEFAULT_GATEWAY_PORT),

    // OpenClaw v0.8.6+ environment variable defaults
    WEBSOCKET_EVENT_CALLER_TIMEOUT: String(WEBSOCKET_EVENT_CALLER_TIMEOUT_MS),
    ENABLE_AUDIT_STDOUT,
  };

  // Auth provider credentials (e.g. CLAUDE_AI_SESSION_KEY, ANTHROPIC_API_KEY)
  if (answers.auth?.env) {
    for (const [key, value] of Object.entries(answers.auth.env)) {
      env[key] = value;
    }
  }

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
 *
 * Session targets default to cost-efficient values per OPENCLAW-REFERENCE.md:
 * - heartbeat → 'isolated' (lightweight check, no context bleed)
 * - skill-* → 'isolated' (background tasks)
 * - work-session → 'main' (needs full conversation context)
 * - morning-brief → 'main' (delivers to user in active chat)
 *
 * Delivery modes default to sensible values:
 * - heartbeat/work-session/skills → 'none' (background)
 * - morning-brief → 'announce' (user-facing)
 *
 * Both can be overridden per job via blueprint cron_config.delivery / cron_config.session_target.
 */
function buildCronJobs(blueprint: Blueprint, timezone?: string): CronJobDefinition[] {
  const jobs: CronJobDefinition[] = [];
  const cron = blueprint.cron_config;
  const routing = cron.model_routing;

  // Compile activeHours from monitoring.quiet_hours for jobs with 'waking' qualifier
  const wakingActiveHours = parseQuietHoursToActiveHours(blueprint.monitoring.quiet_hours, timezone);

  // Helper: build a CronJobDefinition in OpenClaw's native format
  const makeJob = (
    id: string,
    expr: string,
    message: string,
    deliveryMode: string,
    sessionTarget: "isolated" | "main",
    opts?: { model?: string; fallbacks?: readonly string[]; activeHours?: ActiveHours },
  ): CronJobDefinition => ({
    id,
    name: id,
    enabled: true,
    schedule: { kind: "cron", expr },
    delivery: { mode: deliveryMode },
    payload: { kind: "agentTurn", message, ...(opts?.model ? { model: opts.model } : {}) },
    sessionTarget,
    ...(opts?.fallbacks?.length ? { fallbacks: opts.fallbacks } : {}),
    ...(opts?.activeHours ? { activeHours: opts.activeHours } : {}),
  });

  // Heartbeat — regular check-in
  if (cron.heartbeat) {
    const isWaking = hasWakingQualifier(cron.heartbeat);
    const expr = normalizeCronExpr(cron.heartbeat);
    if (expr) {
      const r = routing?.heartbeat;
      jobs.push(makeJob("heartbeat", expr,
        "Run heartbeat check — verify all systems operational",
        cron.delivery?.heartbeat ?? "none",
        (cron.session_target?.heartbeat as "isolated" | "main") ?? "isolated",
        { model: r?.model, fallbacks: r?.fallbacks,
          ...(isWaking && wakingActiveHours ? { activeHours: wakingActiveHours } : {}) },
      ));
    }
  }

  // Work session — periodic active work
  if (cron.work_session) {
    const isWaking = hasWakingQualifier(cron.work_session);
    const expr = normalizeCronExpr(cron.work_session);
    if (expr) {
      const r = routing?.work_session;
      jobs.push(makeJob("work-session", expr,
        "Run scheduled work session — process pending tasks and check integrations",
        cron.delivery?.work_session ?? "none", "main",
        { model: r?.model, fallbacks: r?.fallbacks,
          ...(isWaking && wakingActiveHours ? { activeHours: wakingActiveHours } : {}) },
      ));
    }
  }

  // Morning brief
  if (cron.morning_brief) {
    const expr = normalizeMorningBrief(cron.morning_brief);
    const r = routing?.morning_brief;
    jobs.push(makeJob("morning-brief", expr,
      "Send morning briefing — summarize overnight activity and today's schedule",
      cron.delivery?.morning_brief ?? "announce", "main",
      { model: r?.model, fallbacks: r?.fallbacks },
    ));
  }

  // Skill-specific cron jobs — included skills run on the work-session schedule
  if (cron.work_session && blueprint.skill_bundle?.included) {
    const isWaking = hasWakingQualifier(cron.work_session);
    const skillExpr = normalizeCronExpr(cron.work_session);
    if (skillExpr) {
      const r = routing?.work_session;
      for (const skillName of blueprint.skill_bundle.included) {
        jobs.push(makeJob(`skill-${skillName}`, skillExpr,
          `Run skill: ${skillName}`,
          "none", "isolated",
          { model: r?.model, fallbacks: r?.fallbacks,
            ...(isWaking && wakingActiveHours ? { activeHours: wakingActiveHours } : {}) },
        ));
      }
    }
  }

  return jobs;
}

/**
 * Check if a blueprint cron expression has the 'waking' qualifier.
 */
function hasWakingQualifier(expr: string): boolean {
  return /\s+waking$/i.test(expr);
}

/**
 * Parse monitoring.quiet_hours into activeHours by inverting the range.
 *
 * quiet_hours "23:00-06:00" → activeHours { start: 6, end: 23 }
 * (active from 06:00 to 23:00, quiet from 23:00 to 06:00)
 */
function parseQuietHoursToActiveHours(quietHours: string, timezone?: string): ActiveHours | undefined {
  const match = quietHours.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;

  const quietStart = parseInt(match[1]!, 10);
  const quietEnd = parseInt(match[3]!, 10);

  // Invert: active hours run from quiet end to quiet start
  return {
    start: quietEnd,
    end: quietStart,
    ...(timezone ? { tz: timezone } : {}),
  };
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
    content: f.content,
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

// ── Skill Files ────────────────────────────────────────────────────────────

// Re-export for consumers that import from configure/index.
export type { SkillFileEntry } from "../skills/index.js";

/**
 * Generate pre-built skill files for a blueprint.
 *
 * Always includes platform skills (cron-doctor, scanner-triage).
 * Additionally includes skills listed in blueprint.skill_bundle.included
 * that exist in the configs/skills/ directory.
 *
 * Returns the actual file entries for writing to disk.
 */
export function generateSkillFiles(blueprint: Blueprint): SkillFileEntry[] {
  // Platform skills — always included regardless of blueprint
  const platformFiles = loadPlatformSkills();

  // Blueprint-selected skills from configs/skills/
  const blueprintSkillNames = blueprint.skill_bundle?.included ?? [];
  const blueprintFiles = loadBlueprintSkills(blueprintSkillNames);

  // Deduplicate: platform wins if a skill appears in both
  const platformNames = new Set(platformFiles.map((f) => f.skillName));
  const deduped = blueprintFiles.filter((f) => !platformNames.has(f.skillName));

  return [...platformFiles, ...deduped];
}

/**
 * Build skill file metadata from blueprint.
 *
 * Returns SkillFileInfo entries for inclusion in the deployment bundle.
 */
function buildSkillFiles(blueprint: Blueprint): SkillFileInfo[] {
  return generateSkillFiles(blueprint).map((f) => ({
    skillName: f.skillName,
    path: f.relativePath,
    sizeBytes: Buffer.byteLength(f.content, "utf-8"),
  }));
}

// ── Delegated Rules ─────────────────────────────────────────────────────────

/**
 * Compile delegation rules once — returns both content and metadata.
 *
 * Single compilation point ensures the metadata (ruleCount, sizeBytes)
 * is always consistent with the content.
 */
function compileDelegationRules(blueprint: Blueprint): { content: string; metadata: DelegatedRulesFileInfo } | undefined {
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
    content,
    metadata: {
      path: "workspace/delegated-rules.json",
      sizeBytes: Buffer.byteLength(content, "utf-8"),
      categoryCount: blueprint.delegation_rules.categories.length,
      ruleCount,
    },
  };
}

/**
 * Build delegated rules metadata for the deployment bundle.
 */
function buildDelegatedRulesFile(blueprint: Blueprint): DelegatedRulesFileInfo | undefined {
  return compileDelegationRules(blueprint)?.metadata;
}

/**
 * Generate the compiled delegated-rules.json content from a blueprint.
 *
 * Public API for the writer to get the actual file content.
 */
export function generateDelegatedRulesContent(blueprint: Blueprint): string | undefined {
  return compileDelegationRules(blueprint)?.content;
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
      posture: bp.security_posture.posture === "under-attack"
        ? "under-attack"
        : "hardened",
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
    expr = cleaned.split(/\s+/).map((f, i) => fixCronField(f, i)).join(" ");
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
  const DAY_MAP: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };

  // Accept "HH:MM" or "HH:MM dayname" (e.g. "07:00" or "08:00 monday")
  const match = timeStr.match(/^(\d{1,2}):(\d{2})(?:\s+(\w+))?$/);
  if (match && match[1] !== undefined && match[2] !== undefined) {
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const dayName = match[3]?.toLowerCase();
    const dow = dayName ? DAY_MAP[dayName] : undefined;

    if (dayName && dow === undefined) {
      throw new Error(
        `Invalid morning brief day "${dayName}" in "${timeStr}" — expected a weekday name`,
      );
    }

    const expr = `${minute} ${hour} * * ${dow !== undefined ? dow : "*"}`;

    const errors = validateCronExpr(expr);
    if (errors.length > 0) {
      throw new Error(
        `Invalid morning brief time "${timeStr}": ${errors.join("; ")}`,
      );
    }

    return expr;
  }

  // Accept 5-field cron expression directly (e.g. "0 7 * * *")
  const cronParts = timeStr.trim().split(/\s+/);
  if (cronParts.length === 5) {
    const errors = validateCronExpr(timeStr);
    if (errors.length === 0) {
      return timeStr;
    }
  }

  throw new Error(
    `Invalid morning brief time "${timeStr}" — expected HH:MM format (e.g. "07:00") or 5-field cron expression`,
  );
}

/**
 * Fix a single cron field to prevent LM-09 violations.
 *
 * Bare "N/step" → "min-max/step" using the correct range for that field position.
 */
function fixCronField(field: string, fieldIndex: number): string {
  const match = field.match(/^(\d+)\/(\d+)$/);
  if (match) {
    const range = CRON_FIELD_RANGES[fieldIndex];
    if (!range) return field;
    return `${range.min}-${range.max}/${match[2]}`;
  }
  return field;
}

/** Generate a random hex token for Gateway auth. */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
