/**
 * Config generator for the init wizard.
 *
 * Takes wizard answers and produces a complete DeploymentBundle:
 * openclaw.json, .env, docker-compose.yml, identity files, cron/jobs.json.
 *
 * Validates against all 14 landmine rules before returning.
 */

import type { CronJobDefinition, DeploymentBundle, OpenClawConfig } from "../config/schema.js";
import { validate, validateCronExpression, type ValidationContext } from "../config/validator.js";
import {
  generateOverride,
  overrideToYaml,
  type SecurityPosture,
} from "../docker/hardening.js";

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
    allowedOrigins: ["http://localhost:18789"],
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

  // Build the full compose from the security override
  const services = (override["services"] as Record<string, Record<string, unknown>>)["openclaw"];

  const envVars = generateEnvVars(answers);
  const envFile = Object.keys(envVars).length > 0 ? [".env"] : undefined;

  // Add workspace and cron volumes
  const volumes = [
    ...(services["volumes"] as string[] ?? []),
    `${openclawHome}/workspace:/home/openclaw/.openclaw/workspace`,
    `${openclawHome}/cron:/home/openclaw/.openclaw/cron:ro`,
  ];

  // Add env_file reference
  const compose: Record<string, unknown> = {
    services: {
      openclaw: {
        image: "openclaw:custom",
        container_name: `openclaw-${answers.basics.agentName}`,
        restart: "unless-stopped",
        ports: ["18789:18789"],
        ...services,
        volumes,
        ...(envFile ? { env_file: envFile } : {}),
      },
    },
  };

  // Merge network config from override
  if (override["networks"]) {
    compose["networks"] = override["networks"];
  }

  return overrideToYaml(compose);
}

// --- Identity file generation ---

function generateIdentityFiles(answers: WizardAnswers): Record<string, string> {
  const { basics, template } = answers;
  const files: Record<string, string> = {};

  // SOUL.md — personality and boundaries
  files["SOUL.md"] = [
    `# ${basics.agentName}`,
    "",
    `You are ${basics.agentName}, a ${template.personality.relationship}.`,
    "",
    `## Personality`,
    `- Tone: ${template.personality.tone}`,
    `- Style: ${template.personality.style}`,
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

  // HEARTBEAT.md — cron behavior
  const heartbeatLines = [
    "# Heartbeat Behavior",
    "",
    `Check these integrations: ${template.monitoring.checks.join(", ")}`,
    "",
    "## Monitoring",
    `- Heartbeat frequency: ${template.monitoring.heartbeatFrequency}`,
    `- Quiet hours: ${template.monitoring.quietHours}`,
    "",
    "## Alerts",
    ...template.monitoring.alertOn.map((a) => `- ${a}`),
    "",
  ];
  files["HEARTBEAT.md"] = heartbeatLines.join("\n");

  return files;
}

// --- Cron jobs generation ---

function generateCronJobs(answers: WizardAnswers): CronJobDefinition[] {
  const { basics, template } = answers;
  const jobs: CronJobDefinition[] = [];

  // Convert waking-hour schedule to real cron with quiet hour awareness
  const wakingStart = parseInt(basics.wakingHoursStart.split(":")[0], 10);
  const wakingEnd = parseInt(basics.wakingHoursEnd.split(":")[0], 10);

  // Heartbeat
  if (template.cron.heartbeat) {
    const freq = template.cron.heartbeat.match(/\*\/(\d+)/)?.[1] ?? "10";
    jobs.push({
      id: "heartbeat",
      schedule: `0-59/${freq} ${wakingStart}-${wakingEnd} * * *`,
      task: "heartbeat",
      enabled: true,
    });
  }

  // Work session
  if (template.cron.workSession) {
    const freq = template.cron.workSession.match(/\*\/(\d+)/)?.[1] ?? "15";
    jobs.push({
      id: "work-session",
      schedule: `0-59/${freq} ${wakingStart}-${wakingEnd} * * *`,
      task: "work-session",
      enabled: true,
    });
  }

  // Morning brief
  if (template.cron.morningBrief) {
    const hour = template.cron.morningBrief.split(":")[0] ?? "08";
    const minute = template.cron.morningBrief.split(":")[1] ?? "00";
    jobs.push({
      id: "morning-brief",
      schedule: `${minute} ${hour} * * *`,
      task: "morning-brief",
      enabled: true,
    });
  }

  return jobs;
}

// --- Main generate function ---

export function generate(answers: WizardAnswers): GeneratedConfig {
  const openclawConfig = generateOpenClawConfig(answers);
  const envVars = generateEnvVars(answers);
  const dockerCompose = generateDockerCompose(answers);
  const identityFiles = generateIdentityFiles(answers);
  const cronJobs = generateCronJobs(answers);

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
