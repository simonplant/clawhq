/**
 * Template-to-config mapper — generates a DeploymentBundle from a Template
 * combined with setup answers (agent name, timezone, waking hours, credentials).
 *
 * This is the core transformation: Template (operational profile) + user answers
 * → complete, validated DeploymentBundle ready to write to disk.
 */

import type { CronJobDefinition, DeploymentBundle, OpenClawConfig } from "../config/schema.js";
import { validate, validateCronExpression, type ValidationContext } from "../config/validator.js";
import {
  generateOverride,
  overrideToYaml,
  type SecurityPosture,
} from "../docker/hardening.js";

import type { Template } from "./types.js";

// --- Mapper input ---

export interface MapperAnswers {
  agentName: string;
  timezone: string;
  wakingHoursStart: string;
  wakingHoursEnd: string;
  integrations: MapperIntegration[];
  cloudProviders: MapperCloudProvider[];
}

export interface MapperIntegration {
  provider: string;
  category: string;
  envVar: string;
  credential: string;
}

export interface MapperCloudProvider {
  provider: string;
  envVar: string;
  credential: string;
}

// --- Mapper output ---

export interface MapperResult {
  bundle: DeploymentBundle;
  validationPassed: boolean;
  validationResults: import("../config/schema.js").ValidationResult[];
}

// --- Config generation from Template ---

function generateOpenClawConfig(template: Template, answers: MapperAnswers): OpenClawConfig {
  const config: OpenClawConfig = {
    // LM-01: Must be true for containerized deployments
    dangerouslyDisableDeviceAuth: true,
    // LM-02: Gateway allowed origins
    allowedOrigins: ["http://localhost:18789"],
    // LM-03: Docker bridge gateway
    trustedProxies: ["172.17.0.1"],

    gateway: { port: 18789 },

    identity: { name: answers.agentName },

    // LM-04, LM-05: Tool execution
    tools: {
      exec: {
        host: "gateway",
        security: "full",
      },
    },

    // LM-14: Filesystem restriction based on posture
    fs: {
      workspaceOnly: template.security_posture.posture !== "standard",
    },

    cron: { enabled: true },
  };

  // Configure model providers from cloud providers
  if (answers.cloudProviders.length > 0) {
    const providers: Record<string, { apiKey: string }> = {};
    for (const cp of answers.cloudProviders) {
      providers[cp.provider] = { apiKey: `\${${cp.envVar}}` };
    }
    config.models = { providers };
  }

  // Configure channels if messaging integration exists
  const hasMessaging = answers.integrations.some((i) => i.category === "messaging");
  if (hasMessaging) {
    config.channels = { telegram: { enabled: true } };
  }

  return config;
}

function generateEnvVars(answers: MapperAnswers): Record<string, string> {
  const env: Record<string, string> = {};

  for (const integration of answers.integrations) {
    if (integration.credential) {
      env[integration.envVar] = integration.credential;
    }
  }

  for (const cp of answers.cloudProviders) {
    if (cp.credential) {
      env[cp.envVar] = cp.credential;
    }
  }

  return env;
}

function generateDockerCompose(template: Template, answers: MapperAnswers): string {
  const posture = template.security_posture.posture as SecurityPosture;
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
    `${openclawHome}/workspace:/home/openclaw/.openclaw/workspace`,
    `${openclawHome}/cron:/home/openclaw/.openclaw/cron:ro`,
  ];

  const compose: Record<string, unknown> = {
    services: {
      openclaw: {
        image: "openclaw:custom",
        container_name: `openclaw-${answers.agentName}`,
        restart: "unless-stopped",
        ports: ["18789:18789"],
        ...services,
        volumes,
        ...(envFile ? { env_file: envFile } : {}),
      },
    },
  };

  if (override["networks"]) {
    compose["networks"] = override["networks"];
  }

  return overrideToYaml(compose);
}

function generateIdentityFiles(template: Template, answers: MapperAnswers): Record<string, string> {
  const files: Record<string, string> = {};

  // SOUL.md — personality and boundaries from template
  files["SOUL.md"] = [
    `# ${answers.agentName}`,
    "",
    `You are ${answers.agentName}, a ${template.personality.relationship}.`,
    "",
    "## Personality",
    `- Tone: ${template.personality.tone}`,
    `- Style: ${template.personality.style}`,
    "",
    "## Boundaries",
    template.personality.boundaries,
    "",
    "## Timezone",
    answers.timezone,
    "",
    "## Waking Hours",
    `${answers.wakingHoursStart} - ${answers.wakingHoursEnd}`,
    "",
  ].join("\n");

  // USER.md — user context placeholder
  files["USER.md"] = [
    "# User Context",
    "",
    "<!-- Add details about yourself here so your agent can personalize its behavior. -->",
    "<!-- Examples: your role, work schedule, communication preferences, key contacts -->",
    "",
  ].join("\n");

  // TOOLS.md — available tools based on integrations
  const toolLines = ["# Available Tools", ""];
  for (const integration of answers.integrations) {
    if (integration.credential) {
      toolLines.push(`## ${integration.provider}`);
      toolLines.push(`Category: ${integration.category}`);
      toolLines.push("");
    }
  }
  files["TOOLS.md"] = toolLines.join("\n");

  // HEARTBEAT.md — cron behavior from template monitoring config
  files["HEARTBEAT.md"] = [
    "# Heartbeat Behavior",
    "",
    `Check these integrations: ${template.monitoring.checks.join(", ")}`,
    "",
    "## Monitoring",
    `- Heartbeat frequency: ${template.monitoring.heartbeat_frequency}`,
    `- Quiet hours: ${template.monitoring.quiet_hours}`,
    "",
    "## Alerts",
    ...template.monitoring.alert_on.map((a) => `- ${a}`),
    "",
  ].join("\n");

  return files;
}

function generateCronJobs(template: Template, answers: MapperAnswers): CronJobDefinition[] {
  const jobs: CronJobDefinition[] = [];

  const wakingStart = parseInt(answers.wakingHoursStart.split(":")[0], 10);
  const wakingEnd = parseInt(answers.wakingHoursEnd.split(":")[0], 10);

  // Heartbeat
  if (template.cron_config.heartbeat) {
    const freq = template.cron_config.heartbeat.match(/\*\/(\d+)/)?.[1] ?? "10";
    jobs.push({
      id: "heartbeat",
      schedule: `0-59/${freq} ${wakingStart}-${wakingEnd} * * *`,
      task: "heartbeat",
      enabled: true,
    });
  }

  // Work session
  if (template.cron_config.work_session) {
    const freq = template.cron_config.work_session.match(/\*\/(\d+)/)?.[1] ?? "15";
    jobs.push({
      id: "work-session",
      schedule: `0-59/${freq} ${wakingStart}-${wakingEnd} * * *`,
      task: "work-session",
      enabled: true,
    });
  }

  // Morning brief
  if (template.cron_config.morning_brief) {
    const hour = template.cron_config.morning_brief.split(":")[0] ?? "08";
    const minute = template.cron_config.morning_brief.split(":")[1] ?? "00";
    jobs.push({
      id: "morning-brief",
      schedule: `${minute} ${hour} * * *`,
      task: "morning-brief",
      enabled: true,
    });
  }

  return jobs;
}

// --- Main mapper function ---

/** Generate a complete DeploymentBundle from a Template and user answers. */
export function mapTemplateToConfig(template: Template, answers: MapperAnswers): MapperResult {
  const openclawConfig = generateOpenClawConfig(template, answers);
  const envVars = generateEnvVars(answers);
  const dockerCompose = generateDockerCompose(template, answers);
  const identityFiles = generateIdentityFiles(template, answers);
  const cronJobs = generateCronJobs(template, answers);

  const bundle: DeploymentBundle = {
    openclawConfig,
    envVars,
    dockerCompose,
    identityFiles,
    cronJobs,
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
    const cronResult = validateCronExpression(job.schedule);
    if (cronResult.status === "fail") {
      validationResults.push(cronResult);
    }
  }

  const failures = validationResults.filter((r) => r.status === "fail");
  const validationPassed = failures.length === 0;

  return { bundle, validationPassed, validationResults };
}
