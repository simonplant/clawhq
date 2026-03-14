/**
 * Config generator for the init wizard.
 *
 * Takes wizard answers and produces a complete DeploymentBundle:
 * openclaw.json, .env, docker-compose.yml, Dockerfile, identity files,
 * workspace tools, skills, and cron/jobs.json.
 *
 * Validates against all 14 landmine rules before returning.
 */

import type { CronJobDefinition, DeploymentBundle, OpenClawConfig } from "../config/schema.js";
import { validate, validateCronExpression, type ValidationContext } from "../config/validator.js";
import { generateDockerfile } from "../docker/dockerfile.js";
import {
  generateOverride,
  overrideToYaml,
  type SecurityPosture,
} from "../docker/hardening.js";
import { generateAgentsMd } from "../workspace/identity/agents.js";
import { generateHeartbeatMd } from "../workspace/identity/heartbeat.js";
import { generateIdentityMd } from "../workspace/identity/identity.js";
import { generateMemoryMd } from "../workspace/identity/memory.js";
import { generateToolsMd } from "../workspace/identity/tools-doc.js";
import { generateSkills } from "../workspace/skills/index.js";
import {
  detectProvider,
  generateHimalayaConfig,
} from "../workspace/tools/himalaya-config.js";
import {
  generateWorkspaceTools,
  getEnabledToolNames,
} from "../workspace/tools/registry.js";

import type { WizardAnswers } from "./types.js";

export interface GeneratedConfig {
  bundle: DeploymentBundle;
  validationPassed: boolean;
  validationResults: import("../config/schema.js").ValidationResult[];
}

// --- OpenClaw config generation ---

function generateOpenClawConfig(answers: WizardAnswers): OpenClawConfig {
  const { basics, template, integrations, modelRouting } = answers;

  const config: OpenClawConfig = {
    // LM-01: Must be true for containerized deployments
    dangerouslyDisableDeviceAuth: true,
    // LM-02: Gateway allowed origins
    allowedOrigins: ["http://127.0.0.1:18789"],
    // LM-03: Docker bridge gateway
    trustedProxies: ["172.17.0.1"],

    gateway: {
      port: 18789,
    },

    identity: {
      name: basics.agentName,
    },

    // LM-04, LM-05: Tool execution
    tools: {
      exec: {
        host: "gateway",
        security: "full",
      },
    },

    // LM-14: Filesystem restriction
    fs: {
      workspaceOnly: template.security.posture !== "standard",
    },

    cron: {
      enabled: true,
    },
  };

  // Configure model providers from integrations and cloud setup
  if (!modelRouting.localOnly && modelRouting.cloudProviders.length > 0) {
    const providers: Record<string, { apiKey: string }> = {};
    for (const cp of modelRouting.cloudProviders) {
      providers[cp.provider] = { apiKey: `\${${cp.envVar}}` };
    }
    config.models = { providers };
  }

  // Configure channels if messaging integration is set up
  const messagingIntegration = integrations.find((i) => i.category === "messaging");
  if (messagingIntegration) {
    config.channels = {
      telegram: { enabled: true },
    };
  }

  return config;
}

// --- .env file generation ---

function generateEnvVars(answers: WizardAnswers): Record<string, string> {
  const env: Record<string, string> = {};

  // Integration credentials
  for (const integration of answers.integrations) {
    if (integration.credential) {
      env[integration.envVar] = integration.credential;
    }
  }

  // Cloud provider credentials
  if (!answers.modelRouting.localOnly) {
    for (const cp of answers.modelRouting.cloudProviders) {
      if (cp.credential) {
        env[cp.envVar] = cp.credential;
      }
    }
  }

  return env;
}

// --- docker-compose.yml generation ---

function generateDockerCompose(answers: WizardAnswers): string {
  const posture = answers.template.security.posture as SecurityPosture;
  const openclawHome = "~/.openclaw";

  const override = generateOverride("openclaw", {
    posture,
    workspacePath: `${openclawHome}/workspace`,
    configPath: `${openclawHome}/openclaw.json`,
  });

  const services = (override["services"] as Record<string, Record<string, unknown>>)["openclaw"];

  const envVars = generateEnvVars(answers);
  const envFile = Object.keys(envVars).length > 0 ? [".env"] : undefined;

  const volumes = [
    ...(services["volumes"] as string[] ?? []),
    `${openclawHome}/workspace:/home/node/.openclaw/workspace`,
    `${openclawHome}/cron:/home/node/.openclaw/cron:ro`,
  ];

  // Media mount — bind-mount for attachments/media files
  volumes.push(`${openclawHome}/media:/home/node/.openclaw/media`);

  // Himalaya config mount (read-only) when email is configured
  const hasEmail = answers.integrations.some((i) => i.category === "email" && i.credential);
  if (hasEmail) {
    volumes.push(`${openclawHome}/himalaya.toml:/home/node/.openclaw/workspace/himalaya.toml:ro`);
  }

  const serviceConfig: Record<string, unknown> = {
    image: "openclaw:custom",
    container_name: `openclaw-${answers.basics.agentName}`,
    restart: "unless-stopped",
    user: "1000:1000",
    ports: ["18789:18789"],
    ...services,
    volumes,
    ...(envFile ? { env_file: envFile } : {}),
  };

  // Ollama bridge — when local models are configured, the container needs
  // to reach the host's Ollama instance at host.docker.internal:11434
  const usesOllama = answers.modelRouting.localOnly ||
    answers.modelRouting.cloudProviders.length === 0;
  if (usesOllama) {
    serviceConfig["extra_hosts"] = [
      "host.docker.internal:host-gateway",
    ];
  }

  const compose: Record<string, unknown> = {
    services: {
      openclaw: serviceConfig,
    },
  };

  if (override["networks"]) {
    compose["networks"] = override["networks"];
  }

  return overrideToYaml(compose);
}

// --- Cron jobs generation ---

function generateCronJobs(answers: WizardAnswers): CronJobDefinition[] {
  const { basics, template } = answers;
  const jobs: CronJobDefinition[] = [];

  const wakingStart = parseInt(basics.wakingHoursStart.split(":")[0], 10);
  const wakingEnd = parseInt(basics.wakingHoursEnd.split(":")[0], 10);

  const wakingRange = wakingStart <= wakingEnd
    ? `${wakingStart}-${wakingEnd}`
    : `${wakingStart}-23,0-${wakingEnd}`;

  // Heartbeat
  if (template.cron.heartbeat) {
    const freq = template.cron.heartbeat.match(/\*\/(\d+)/)?.[1] ?? "10";
    const minuteExpr = parseInt(freq, 10) === 1 ? "*" : `0-59/${freq}`;
    jobs.push({
      id: "heartbeat",
      kind: "cron",
      expr: `${minuteExpr} ${wakingRange} * * *`,
      task: "Run the heartbeat cycle as defined in HEARTBEAT.md",
      enabled: true,
      delivery: "announce",
      activeHours: { start: wakingStart, end: wakingEnd, tz: basics.timezone },
    });
  }

  // Work session
  if (template.cron.workSession) {
    const freq = template.cron.workSession.match(/\*\/(\d+)/)?.[1] ?? "15";
    const offset = Math.min(3, parseInt(freq, 10) - 1);
    const minuteExpr = `${offset}-59/${freq}`;
    jobs.push({
      id: "work-session",
      kind: "cron",
      expr: `${minuteExpr} ${wakingRange} * * *`,
      task: "Pick the top task from `tasks next` and execute it fully.",
      enabled: true,
      delivery: "announce",
      activeHours: { start: wakingStart, end: wakingEnd, tz: basics.timezone },
    });
  }

  // Morning brief
  if (template.cron.morningBrief) {
    const hour = template.cron.morningBrief.split(":")[0] ?? "08";
    const minute = template.cron.morningBrief.split(":")[1] ?? "00";
    jobs.push({
      id: "morning-brief",
      kind: "cron",
      expr: `${minute} ${hour} * * *`,
      task: "Deliver the morning brief using the morning-brief skill.",
      enabled: true,
      delivery: "announce",
    });
  }

  // Construct (self-improvement) — daily at 02:00 UTC
  if (template.skillsIncluded.includes("construct")) {
    jobs.push({
      id: "construct-daily",
      kind: "cron",
      expr: "0 2 * * *",
      task: "Run the construct skill: assess, propose, build.",
      enabled: true,
      delivery: "none",
    });
  }

  return jobs;
}

// --- Identity files generation ---

function generateIdentityFiles(
  answers: WizardAnswers,
  enabledTools: string[],
  cronJobs: CronJobDefinition[],
): Record<string, string> {
  const { basics, template } = answers;
  const files: Record<string, string> = {};

  // SOUL.md
  files["SOUL.md"] = [
    `# SOUL.md — Who I Am`,
    "",
    `## Mission`,
    "",
    `${basics.agentName}'s protection and flourishing.`,
    "",
    `## What I Am`,
    "",
    `A ${template.personality.relationship}. ${template.personality.style}.`,
    "",
    `## Principles`,
    "",
    "- **Non-harm.** First, always.",
    "- **Genuine compassion.** Accountability without judgment.",
    "- **Clear seeing over reacting.** Pause when urgent.",
    "- **Adapt** to how things are becoming, not how they were.",
    "- **Honest, timely, useful.**",
    "",
    "## Hard Stops",
    "",
    "- Harm to the user or others",
    "- Threats, manipulation, deception",
    "- Breaking the law",
    "- Irreversible actions without confirmation",
    "- Betrayal of trust",
    "",
    "## Data Covenant",
    "",
    "- Read before write. Write before delete.",
    "- Never delete without confirmation.",
    "- Trash over rm — always.",
    "",
    `## Boundaries`,
    template.personality.boundaries,
    "",
    `## Timezone`,
    basics.timezone,
    "",
    `## Waking Hours`,
    `${basics.wakingHoursStart} - ${basics.wakingHoursEnd}`,
    "",
  ].join("\n");

  // USER.md
  files["USER.md"] = [
    "# User Context",
    "",
    "<!-- Add details about yourself here so your agent can personalize its behavior. -->",
    "<!-- Examples: your role, work schedule, communication preferences, key contacts -->",
    "",
  ].join("\n");

  files["IDENTITY.md"] = generateIdentityMd(answers);
  files["AGENTS.md"] = generateAgentsMd(answers);
  files["HEARTBEAT.md"] = generateHeartbeatMd(answers);
  files["TOOLS.md"] = generateToolsMd(answers, enabledTools, cronJobs);
  files["MEMORY.md"] = generateMemoryMd(answers);

  return files;
}

// --- Main generate function ---

export function generate(answers: WizardAnswers): GeneratedConfig {
  const openclawConfig = generateOpenClawConfig(answers);
  const envVars = generateEnvVars(answers);
  const dockerCompose = generateDockerCompose(answers);
  const cronJobs = generateCronJobs(answers);

  // Generate workspace tools
  const includeMarkets = answers.template.monitoring.checks.includes("markets");
  const { tools: workspaceTools, requiredBinaries } = generateWorkspaceTools({
    integrations: answers.integrations,
    includeMarkets,
  });

  // Generate Dockerfile
  const hasGithub = answers.integrations.some((i) => i.category === "code" && i.credential);
  if (hasGithub) {
    requiredBinaries.add("gh");
  }
  requiredBinaries.add("git");
  const dockerfile = generateDockerfile({ requiredBinaries });

  // Generate identity files
  const enabledTools = getEnabledToolNames({
    integrations: answers.integrations,
    includeMarkets,
  });
  const identityFiles = generateIdentityFiles(answers, enabledTools, cronJobs);

  // Generate skills
  const skills = generateSkills(answers.template.skillsIncluded);

  // Himalaya config when email integration is configured
  const emailIntegration = answers.integrations.find((i) => i.category === "email" && i.credential);
  let himalayaConfig: string | undefined;
  if (emailIntegration) {
    const email = answers.emailAddress ?? emailIntegration.credential;
    const provider = detectProvider(email);
    if (provider) {
      himalayaConfig = generateHimalayaConfig({
        accountName: answers.basics.agentName,
        email,
        provider,
        passwordEnvVar: emailIntegration.envVar,
      });
    }
  }

  const bundle: DeploymentBundle = {
    openclawConfig,
    envVars,
    dockerCompose,
    dockerfile,
    identityFiles,
    workspaceTools,
    skills,
    cronJobs,
    ...(himalayaConfig ? { himalayaConfig } : {}),
  };

  // Validate against all 14 landmine rules
  const ctx: ValidationContext = {
    openclawConfig,
    openclawHome: "~/.openclaw",
    composeContent: dockerCompose,
    envContent: Object.entries(envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  };

  const validationResults = validate(ctx);

  // Also validate cron expressions (LM-09)
  for (const job of cronJobs) {
    if (job.kind === "cron" && job.expr) {
      const cronResult = validateCronExpression(job.expr);
      if (cronResult.status === "fail") {
        validationResults.push(cronResult);
      }
    }
  }

  const failures = validationResults.filter((r) => r.status === "fail");
  const validationPassed = failures.length === 0;

  return {
    bundle,
    validationPassed,
    validationResults,
  };
}

export {
  generateOpenClawConfig,
  generateEnvVars,
  generateDockerCompose,
  generateIdentityFiles,
  generateCronJobs,
};
