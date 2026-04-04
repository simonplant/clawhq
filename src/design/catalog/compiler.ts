/**
 * Composition compiler — profile + personality → complete workspace.
 *
 * Takes a mission profile (WHAT), personality preset (HOW), and user config,
 * then compiles them into the 8 OpenClaw workspace files + openclaw.json +
 * .env + cron/jobs.json.
 *
 * No intermediate abstractions survive — output is flat files ready
 * for the deployment directory.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  BOOTSTRAP_MAX_CHARS,
  FILE_MODE_EXEC,
  GATEWAY_DEFAULT_PORT,
} from "../../config/defaults.js";
import { renderDimensionProse, DIMENSION_META, ALWAYS_ON_BOUNDARIES } from "../blueprints/personality-presets.js";
import type { PersonalityDimensions, DimensionId, DimensionValue } from "../blueprints/types.js";

import { generateEmailTool } from "../tools/email.js";
import { generateIcalTool } from "../tools/ical.js";
import { generateJournalTool } from "../tools/journal.js";
import { generateTasksTool } from "../tools/tasks.js";
import { generateTodoistTool } from "../tools/todoist.js";
import { generateTodoistSyncTool } from "../tools/todoist-sync.js";
import { generateTavilyTool } from "../tools/tavily.js";
import { generateQuoteTool } from "../tools/quote.js";
import { generateSanitizeTool } from "../tools/sanitize.js";
import { generateApproveActionTool } from "../tools/approve-action.js";

import { loadProfile, loadPersonality } from "./loader.js";
import { getEgressForProviders, getProvider } from "./providers.js";
import type { Provider } from "./providers.js";
import type {
  CompiledFile,
  CompiledWorkspace,
  CompositionConfig,
  MissionProfile,
  PersonalityPreset,
  ProfileTool,
  UserConfig,
} from "./types.js";

// ── Constants ───────────────────────────────────────────────────────────────

const DOCKER_HOST_GATEWAY = "host.docker.internal";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Compile a composition into a complete workspace.
 */
export function compile(
  config: CompositionConfig,
  user: UserConfig,
  deployDir: string,
  gatewayPort: number = GATEWAY_DEFAULT_PORT,
): CompiledWorkspace {
  const profile = loadProfile(config.profile);
  const personality = loadPersonality(config.personality);

  // Resolve selected providers
  const providerIds = Object.values(config.providers ?? {});
  const resolvedProviders = providerIds
    .map((id) => getProvider(id))
    .filter((p): p is Provider => p !== undefined);

  // Compute egress domains: profile defaults + provider-specific
  const providerEgress = getEgressForProviders(providerIds);
  const allEgress = [...new Set([...profile.egress_domains, ...providerEgress])];

  // Apply dimension overrides
  const dims = applyOverrides(personality.dimensions, config.dimension_overrides);

  const files: CompiledFile[] = [
    // 8 workspace files
    { relativePath: "workspace/SOUL.md", content: renderSoul(personality, dims, config.soul_overrides) },
    { relativePath: "workspace/AGENTS.md", content: renderAgents(profile) },
    { relativePath: "workspace/USER.md", content: renderUser(user) },
    { relativePath: "workspace/TOOLS.md", content: renderTools(profile) },
    { relativePath: "workspace/IDENTITY.md", content: renderIdentity(personality) },
    { relativePath: "workspace/HEARTBEAT.md", content: renderHeartbeat(profile) },
    { relativePath: "workspace/MEMORY.md", content: "" },

    // Runtime config
    { relativePath: "engine/openclaw.json", content: renderOpenclawJson(profile, user, gatewayPort) },
    { relativePath: "engine/.env", content: renderEnv(gatewayPort, resolvedProviders), mode: 0o600 },
    { relativePath: "engine/credentials.json", content: "{}\n", mode: 0o600 },

    // Cron
    { relativePath: "cron/jobs.json", content: renderCronJobs(profile) },

    // Ops — egress includes provider-specific domains
    { relativePath: "ops/firewall/allowlist.yaml", content: renderAllowlistFromDomains(profile, allEgress) },

    // ClawHQ metadata
    { relativePath: "clawhq.yaml", content: renderClawhqYaml(profile, personality, deployDir, config.providers) },

    // ClawWall security assets (copied into Docker image at build time)
    { relativePath: "engine/clawwall/sanitize", content: renderClawwallSanitize(), mode: FILE_MODE_EXEC },
    { relativePath: "engine/clawwall/curl-egress-wrapper", content: renderCurlEgressWrapper(), mode: FILE_MODE_EXEC },

    // Tool scripts (executable on PATH inside container)
    ...generateToolScripts(profile),

    // Bundled skills
    ...loadBundledSkills(profile),
  ];

  return { files, profile, personality };
}

// ── SOUL.md ─────────────────────────────────────────────────────────────────

function renderSoul(
  personality: PersonalityPreset,
  dims: PersonalityDimensions,
  soulOverrides?: string,
): string {
  const lines: string[] = [];

  lines.push(`# ${personality.name}\n`);
  lines.push(`> ${personality.description}\n`);

  // Communication style from dimensions
  lines.push("## Communication Style\n");
  for (const meta of DIMENSION_META) {
    const value = dims[meta.id as DimensionId] as DimensionValue;
    lines.push(renderDimensionProse(meta.id as DimensionId, value));
  }
  lines.push("");

  // Values
  lines.push("## Values\n");
  lines.push(personality.values.trim());
  lines.push("");

  // Voice examples
  lines.push("## Voice Examples\n");
  lines.push("These examples show how you communicate. Match this tone:\n");
  for (const example of personality.voice_examples) {
    lines.push(`> ${example}\n`);
  }

  // Anti-patterns
  lines.push("## Anti-Patterns\n");
  for (const ap of personality.anti_patterns) {
    lines.push(`- ${ap}`);
  }
  lines.push("");

  // Boundaries (personality-specific)
  lines.push("## Boundaries\n");
  lines.push(personality.boundaries.trim());
  lines.push("");

  // Hard security boundaries (always-on, non-negotiable)
  lines.push("## Hard Limits\n");
  for (const boundary of ALWAYS_ON_BOUNDARIES) {
    lines.push(`- ${boundary}`);
  }
  lines.push("");

  // User overrides
  if (soulOverrides) {
    lines.push("## Additional Notes\n");
    lines.push(soulOverrides.trim());
    lines.push("");
  }

  return lines.join("\n");
}

// ── AGENTS.md ───────────────────────────────────────────────────────────────

function renderAgents(profile: MissionProfile): string {
  const lines: string[] = [];

  lines.push(`# ${profile.name} — Operating Manual\n`);

  lines.push("## Every Session\n");
  lines.push("Before doing anything else:");
  lines.push("1. Read `SOUL.md` — this is who you are");
  lines.push("2. Read `USER.md` — this is who you're helping");
  lines.push("3. Read `memory/` (today + yesterday) for recent context");
  lines.push("4. If in MAIN SESSION: Also read `MEMORY.md`\n");

  lines.push("## Memory Rules\n");
  lines.push("- Decisions, preferences, and durable facts → `MEMORY.md`");
  lines.push("- Day-to-day notes and running context → `memory/YYYY-MM-DD.md`");
  lines.push("- If someone says \"remember this,\" write it immediately");
  lines.push("- After completing meaningful work: update daily log\n");

  // Delegation / autonomy
  lines.push("## Autonomy Model\n");
  lines.push(`Default autonomy: **${profile.autonomy_default}**\n`);

  const execute = profile.delegation.filter((d) => d.tier === "execute");
  const propose = profile.delegation.filter((d) => d.tier === "propose");
  const approve = profile.delegation.filter((d) => d.tier === "approve");

  if (execute.length > 0) {
    lines.push("### Do Autonomously (execute)");
    for (const d of execute) {
      lines.push(`- **${d.action}** — ${d.example}`);
    }
    lines.push("");
  }

  if (propose.length > 0) {
    lines.push("### Propose First (propose)");
    for (const d of propose) {
      lines.push(`- **${d.action}** — ${d.example}`);
    }
    lines.push("");
  }

  if (approve.length > 0) {
    lines.push("### Requires Approval (approve)");
    for (const d of approve) {
      lines.push(`- **${d.action}** — ${d.example}`);
    }
    lines.push("");
  }

  lines.push("## Safety\n");
  lines.push("- Show the plan, get explicit approval, then execute");
  lines.push("- No autonomous bulk operations");
  lines.push("- No destructive commands without confirmation");
  lines.push("- Don't dump directories or secrets into chat\n");

  lines.push("## A Day in the Life\n");
  lines.push(profile.day_in_the_life.trim());
  lines.push("");

  return lines.join("\n");
}

// ── USER.md ─────────────────────────────────────────────────────────────────

function renderUser(user: UserConfig): string {
  const lines: string[] = [];

  lines.push("# About You\n");
  lines.push(`**Name:** ${user.name}`);
  lines.push(`**Timezone:** ${user.timezone}`);
  lines.push(`**Communication preference:** ${user.communication}\n`);

  if (user.constraints) {
    lines.push("## Constraints\n");
    lines.push(user.constraints.trim());
    lines.push("");
  }

  return lines.join("\n");
}

// ── TOOLS.md ────────────────────────────────────────────────────────────────

function renderTools(profile: MissionProfile): string {
  const lines: string[] = [];

  lines.push(`# Tools — ${profile.name}\n`);
  lines.push("These tools are available on your PATH. Use them for their designated purpose.\n");

  // Group by category
  const byCategory = new Map<string, ProfileTool[]>();
  for (const tool of profile.tools) {
    const existing = byCategory.get(tool.category) ?? [];
    existing.push(tool);
    byCategory.set(tool.category, existing);
  }

  for (const [category, tools] of byCategory) {
    lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}\n`);
    for (const tool of tools) {
      const req = tool.required ? "(required)" : "(optional)";
      lines.push(`### \`${tool.name}\` ${req}`);
      lines.push(tool.description);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── IDENTITY.md ─────────────────────────────────────────────────────────────

function renderIdentity(personality: PersonalityPreset): string {
  const lines: string[] = [];

  lines.push("# Identity\n");
  lines.push(`**Name:** ${personality.name}`);
  lines.push(`**Emoji:** ${personality.identity.emoji}`);
  lines.push(`**Vibe:** ${personality.identity.vibe}`);
  lines.push(`**Creature:** AI assistant\n`);

  return lines.join("\n");
}

// ── HEARTBEAT.md ────────────────────────────────────────────────────────────

function renderHeartbeat(profile: MissionProfile): string {
  const checks = profile.monitoring.checks;
  if (checks.length === 0) return "";

  const lines: string[] = [];
  lines.push("## Heartbeat Checks\n");
  for (const check of checks) {
    lines.push(`- [ ] Check ${check} for anything urgent`);
  }
  lines.push("\nIf nothing needs attention, respond `HEARTBEAT_OK`.");
  lines.push("");

  return lines.join("\n");
}

// ── openclaw.json ───────────────────────────────────────────────────────────

function renderOpenclawJson(
  profile: MissionProfile,
  user: UserConfig,
  port: number,
): string {
  const config: Record<string, unknown> = {
    tools: {
      exec: {
        host: "gateway",
        security: "full",
      },
      fs: {
        workspaceOnly: false,
      },
    },
    gateway: {
      port,
      bind: "lan",
      mode: "local",
      auth: {
        mode: "token",
        token: "${OPENCLAW_GATEWAY_TOKEN}",
      },
      controlUi: {
        dangerouslyDisableDeviceAuth: true,
        allowedOrigins: [`http://127.0.0.1:${port}`],
      },
      trustedProxies: ["172.17.0.1"],
    },
    channels: {
      telegram: {
        enabled: true,
        dmPolicy: "pairing",
      },
    },
    session: {
      dmScope: "per-channel-peer",
    },
    agents: {
      defaults: {
        model: {
          primary: "ollama/gemma3:27b",
        },
        memorySearch: {
          provider: "ollama",
          store: { vector: { enabled: true } },
        },
      },
    },
    models: {
      providers: {
        ollama: {
          baseUrl: `http://${DOCKER_HOST_GATEWAY}:11434`,
          models: [],
        },
      },
    },
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

  return JSON.stringify(config, null, 2) + "\n";
}

// ── .env ────────────────────────────────────────────────────────────────────

function renderEnv(port: number, providers: Provider[]): string {
  const token = randomBytes(32).toString("hex");
  const lines = [
    "# Generated by clawhq — fill in real values before deploying",
    `OPENCLAW_GATEWAY_TOKEN=${token}`,
    `GATEWAY_PORT=${port}`,
    "",
  ];

  // Add provider-specific env var templates
  if (providers.length > 0) {
    lines.push("# ── Provider Credentials ──");
    for (const provider of providers) {
      if (provider.envVars.length === 0) continue;
      lines.push(`# ${provider.name} (${provider.domain})`);
      for (const ev of provider.envVars) {
        const value = ev.default ?? "CHANGE_ME";
        lines.push(`${ev.key}=${value}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── cron/jobs.json ──────────────────────────────────────────────────────────

function renderCronJobs(profile: MissionProfile): string {
  const jobs: Record<string, unknown>[] = [];

  for (const [id, schedule] of Object.entries(profile.cron_defaults)) {
    const prompt = profile.cron_prompts[id] ?? `Run ${id}`;

    jobs.push({
      id,
      schedule,
      prompt,
      enabled: true,
      delivery: id === "morning_brief" ? "announce" : "none",
      model: id === "heartbeat" ? "haiku" : undefined,
    });
  }

  return JSON.stringify(jobs, null, 2) + "\n";
}

// ── allowlist.yaml ──────────────────────────────────────────────────────────

function renderAllowlistFromDomains(profile: MissionProfile, allDomains: string[]): string {
  const lines = [
    "# Egress firewall allowlist",
    `# Generated for profile: ${profile.id}`,
    "# Domains computed from profile defaults + selected providers",
    "",
    "domains:",
  ];
  for (const domain of allDomains) {
    lines.push(`  - ${domain}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ── clawhq.yaml ─────────────────────────────────────────────────────────────

function renderClawhqYaml(
  profile: MissionProfile,
  personality: PersonalityPreset,
  deployDir: string,
  providers?: Readonly<Record<string, string>>,
): string {
  const config: Record<string, unknown> = {
    version: "0.2.0",
    composition: {
      profile: profile.id,
      personality: personality.id,
      ...(providers && Object.keys(providers).length > 0 ? { providers } : {}),
    },
    installMethod: "cache",
    security: {
      posture: profile.security_posture,
      egress: "allowlist-only",
    },
    paths: {
      deployDir,
      engineDir: `${deployDir}/engine`,
      workspaceDir: `${deployDir}/workspace`,
      opsDir: `${deployDir}/ops`,
    },
  };

  // Simple YAML serialization
  return serializeSimpleYaml(config);
}

// ── Tool Scripts ────────────────────────────────────────────────────────────

// ── ClawWall Security Assets ────────────────────────────────────────────────

function renderClawwallSanitize(): string {
  // Use the same sanitize generator as the workspace tool
  return generateSanitizeTool();
}

function renderCurlEgressWrapper(): string {
  // Load from clawhq's secure module
  const wrapperPath = resolve(findConfigsDir(), "..", "src", "secure", "clawwall", "curl-egress-wrapper");
  if (existsSync(wrapperPath)) {
    return readFileSync(wrapperPath, "utf-8");
  }
  // Fallback: try dist path
  const distPath = resolve(import.meta.dirname ?? __dirname, "..", "..", "secure", "clawwall", "curl-egress-wrapper");
  if (existsSync(distPath)) {
    return readFileSync(distPath, "utf-8");
  }
  // Minimal passthrough if file not found
  return '#!/bin/bash\nexec /usr/bin/curl "$@"\n';
}

/** Registry of tool name → script generator function. */
const TOOL_REGISTRY: Readonly<Record<string, () => string>> = {
  email: generateEmailTool,
  ical: generateIcalTool,
  journal: generateJournalTool,
  tasks: generateTasksTool,
  todoist: generateTodoistTool,
  "todoist-sync": generateTodoistSyncTool,
  tavily: generateTavilyTool,
  quote: generateQuoteTool,
  sanitize: generateSanitizeTool,
  "approve-action": generateApproveActionTool,
};

/**
 * Generate executable tool scripts for the profile's tools.
 * Tools are placed at workspace/ root so they're on PATH inside the container.
 */
function generateToolScripts(profile: MissionProfile): CompiledFile[] {
  const files: CompiledFile[] = [];

  for (const tool of profile.tools) {
    const generator = TOOL_REGISTRY[tool.name];
    if (generator) {
      files.push({
        relativePath: `workspace/${tool.name}`,
        content: generator(),
        mode: FILE_MODE_EXEC,
      });
    }
  }

  // Always include sanitize (ClawWall) — security platform tool
  if (!files.some((f) => f.relativePath === "workspace/sanitize")) {
    files.push({
      relativePath: "workspace/sanitize",
      content: generateSanitizeTool(),
      mode: FILE_MODE_EXEC,
    });
  }

  return files;
}

// ── Bundled Skills ──────────────────────────────────────────────────────────

/**
 * Load bundled skills from configs/skills/ based on the profile's skills list.
 */
function loadBundledSkills(profile: MissionProfile): CompiledFile[] {
  const files: CompiledFile[] = [];
  const configsDir = findConfigsDir();
  const skillsDir = join(configsDir, "skills");

  if (!existsSync(skillsDir)) return files;

  for (const skillName of profile.skills) {
    const skillDir = join(skillsDir, skillName);
    if (!existsSync(skillDir)) continue;

    // Read all files in the skill directory
    try {
      const entries = readdirSync(skillDir);
      for (const entry of entries) {
        const filePath = join(skillDir, entry);
        try {
          const content = readFileSync(filePath, "utf-8");
          files.push({
            relativePath: `workspace/skills/${skillName}/${entry}`,
            content,
          });
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Skip unreadable skill directories
    }
  }

  return files;
}

/** Find the configs/ directory. */
function findConfigsDir(): string {
  let dir = resolve(import.meta.dirname ?? __dirname, "..", "..", "..");
  const candidate = join(dir, "configs");
  if (existsSync(candidate)) return candidate;
  return join(process.cwd(), "configs");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function applyOverrides(
  base: PersonalityDimensions,
  overrides?: Partial<PersonalityDimensions>,
): PersonalityDimensions {
  if (!overrides) return base;
  return {
    directness: overrides.directness ?? base.directness,
    warmth: overrides.warmth ?? base.warmth,
    verbosity: overrides.verbosity ?? base.verbosity,
    proactivity: overrides.proactivity ?? base.proactivity,
    caution: overrides.caution ?? base.caution,
    formality: overrides.formality ?? base.formality,
    analyticalDepth: overrides.analyticalDepth ?? base.analyticalDepth,
  };
}

function serializeSimpleYaml(obj: Record<string, unknown>, indent = 0): string {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      lines.push(serializeSimpleYaml(value as Record<string, unknown>, indent + 1));
    } else {
      lines.push(`${pad}${key}: ${value}`);
    }
  }

  return lines.join("\n");
}
