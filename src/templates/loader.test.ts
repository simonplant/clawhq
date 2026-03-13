import { describe, it, expect } from "vitest";

import { loadBuiltInTemplates, loadTemplateFromString } from "./loader.js";
import { mapTemplateToConfig, type MapperAnswers } from "./mapper.js";
import { formatPreview, generatePreview } from "./preview.js";
import { EGRESS_STRICTNESS, LAYER1_SECURITY_BASELINE, POSTURE_STRICTNESS } from "./types.js";

// --- Minimal valid template YAML for tests ---

const VALID_TEMPLATE_YAML = `
name: Test Template
version: "1.0.0"

use_case_mapping:
  replaces: Test Product
  tagline: "Test tagline"
  description: "Test description"
  day_in_the_life: "Test day in the life narrative"

personality:
  tone: direct
  style: "test style"
  relationship: test partner
  boundaries: "test boundaries"

security_posture:
  posture: hardened
  egress: restricted
  identity_mount: read-only

monitoring:
  heartbeat_frequency: "10min"
  checks:
    - email
  quiet_hours: "23:00-06:00"
  alert_on:
    - credential_expiry

memory_policy:
  hot_max: "100KB"
  hot_retention: "7d"
  warm_retention: "90d"
  cold_retention: "365d"
  summarization: balanced

cron_config:
  heartbeat: "*/10 waking"
  work_session: "*/15 waking"
  morning_brief: "08:00"

autonomy_model:
  default: medium
  requires_approval:
    - large_purchases

model_routing_strategy:
  default_provider: local
  local_model_preference: "llama3:8b"
  cloud_escalation_categories:
    - research
  quality_threshold: medium

integration_requirements:
  required:
    - messaging
  recommended:
    - email
  optional:
    - notes

skill_bundle:
  included:
    - morning-brief
  recommended:
    - email-triage
`;

function loadValid() {
  const result = loadTemplateFromString(VALID_TEMPLATE_YAML);
  if (!result.template) {
    throw new Error(`Failed to load valid template: ${result.errors.map((e) => e.message).join(", ")}`);
  }
  return result.template;
}

// --- Loader tests ---

describe("loadTemplateFromString", () => {
  it("loads a valid template without errors", () => {
    const result = loadTemplateFromString(VALID_TEMPLATE_YAML);
    expect(result.errors).toHaveLength(0);
    expect(result.template).not.toBeNull();

    const t = loadValid();
    expect(t.name).toBe("Test Template");
    expect(t.version).toBe("1.0.0");
  });

  it("returns errors for invalid YAML", () => {
    const result = loadTemplateFromString("{ unclosed: [");
    expect(result.template).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].field).toBe("yaml");
  });

  it("returns errors for missing required fields", () => {
    const result = loadTemplateFromString("name: Test\n");
    expect(result.template).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns error when name is empty", () => {
    const yaml = VALID_TEMPLATE_YAML.replace('name: Test Template', 'name: ""');
    const result = loadTemplateFromString(yaml);
    expect(result.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("returns error for invalid posture", () => {
    const yaml = VALID_TEMPLATE_YAML.replace("posture: hardened", "posture: relaxed");
    const result = loadTemplateFromString(yaml);
    expect(result.errors.some((e) => e.field === "security_posture.posture")).toBe(true);
  });

  it("returns error for invalid egress", () => {
    const yaml = VALID_TEMPLATE_YAML.replace("egress: restricted", "egress: open");
    const result = loadTemplateFromString(yaml);
    expect(result.errors.some((e) => e.field === "security_posture.egress")).toBe(true);
  });

  it("returns error for invalid summarization", () => {
    const yaml = VALID_TEMPLATE_YAML.replace("summarization: balanced", "summarization: extreme");
    const result = loadTemplateFromString(yaml);
    expect(result.errors.some((e) => e.field === "memory_policy.summarization")).toBe(true);
  });

  it("returns error for invalid autonomy level", () => {
    const yaml = VALID_TEMPLATE_YAML.replace("default: medium", "default: extreme");
    const result = loadTemplateFromString(yaml);
    expect(result.errors.some((e) => e.field === "autonomy_model.default")).toBe(true);
  });

  it("returns error when identity_mount is not read-only", () => {
    const yaml = VALID_TEMPLATE_YAML.replace("identity_mount: read-only", "identity_mount: read-write");
    const result = loadTemplateFromString(yaml);
    expect(result.errors.some((e) => e.field === "security_posture.identity_mount")).toBe(true);
  });

  it("preserves all template fields", () => {
    const t = loadValid();

    expect(t.use_case_mapping.replaces).toBe("Test Product");
    expect(t.personality.tone).toBe("direct");
    expect(t.security_posture.posture).toBe("hardened");
    expect(t.monitoring.checks).toEqual(["email"]);
    expect(t.memory_policy.hot_max).toBe("100KB");
    expect(t.cron_config.heartbeat).toBe("*/10 waking");
    expect(t.autonomy_model.requires_approval).toEqual(["large_purchases"]);
    expect(t.model_routing_strategy.default_provider).toBe("local");
    expect(t.integration_requirements.required).toEqual(["messaging"]);
    expect(t.skill_bundle.included).toEqual(["morning-brief"]);
  });
});

// --- Security baseline enforcement ---

describe("Layer 1 security baseline enforcement", () => {
  it("rejects templates that loosen security posture below baseline", () => {
    expect(POSTURE_STRICTNESS["standard"]).toBe(0);
    expect(POSTURE_STRICTNESS["hardened"]).toBe(1);
    expect(POSTURE_STRICTNESS["paranoid"]).toBe(2);
  });

  it("allows templates that tighten security posture", () => {
    const result = loadTemplateFromString(VALID_TEMPLATE_YAML);
    expect(result.errors).toHaveLength(0);
    expect(result.template).not.toBeNull();

    const t = loadValid();
    expect(
      POSTURE_STRICTNESS[t.security_posture.posture] >=
      POSTURE_STRICTNESS[LAYER1_SECURITY_BASELINE.posture],
    ).toBe(true);
  });

  it("enforces egress strictness ordering", () => {
    expect(EGRESS_STRICTNESS["default"]).toBe(0);
    expect(EGRESS_STRICTNESS["restricted"]).toBe(1);
    expect(EGRESS_STRICTNESS["allowlist-only"]).toBe(2);
  });
});

// --- Built-in template loading ---

describe("loadBuiltInTemplates", () => {
  it("loads all 6 built-in templates without errors", async () => {
    const results = await loadBuiltInTemplates();

    expect(results.has("_error")).toBe(false);
    expect(results.size).toBe(6);

    for (const [, result] of results) {
      expect(result.errors).toHaveLength(0);
      expect(result.template).not.toBeNull();
      if (result.template) {
        expect(result.template.name).toBeTruthy();
        expect(result.template.version).toBe("1.0.0");
      }
    }
  });

  it("loads expected template IDs", async () => {
    const results = await loadBuiltInTemplates();
    const ids = [...results.keys()].sort();

    expect(ids).toEqual([
      "family-hub",
      "founders-ops",
      "replace-chatgpt-plus",
      "replace-google-assistant",
      "replace-my-pa",
      "research-copilot",
    ]);
  });

  it("all built-in templates meet Layer 1 security baseline", async () => {
    const results = await loadBuiltInTemplates();

    for (const [, result] of results) {
      if (!result.template) continue;
      const t = result.template;
      expect(
        POSTURE_STRICTNESS[t.security_posture.posture] >=
        POSTURE_STRICTNESS[LAYER1_SECURITY_BASELINE.posture],
      ).toBe(true);
      expect(
        EGRESS_STRICTNESS[t.security_posture.egress] >=
        EGRESS_STRICTNESS[LAYER1_SECURITY_BASELINE.egress],
      ).toBe(true);
      expect(t.security_posture.identity_mount).toBe("read-only");
    }
  });
});

// --- Preview tests ---

describe("generatePreview", () => {
  it("generates complete preview from template", () => {
    const t = loadValid();
    const preview = generatePreview(t);

    expect(preview.name).toBe("Test Template");
    expect(preview.replaces).toBe("Test Product");
    expect(preview.integrationsRequired).toEqual(["messaging"]);
    expect(preview.integrationsRecommended).toEqual(["email"]);
    expect(preview.autonomyLevel).toBe("medium");
    expect(preview.securityPosture).toBe("hardened");
    expect(preview.skillsIncluded).toEqual(["morning-brief"]);
    expect(preview.estimatedDailyCost.localOnly).toContain("$0.00");
    expect(preview.estimatedDailyCost.withCloud).toBeTruthy();
    expect(preview.localModelRequirements).toContain("llama3:8b");
  });

  it("formats preview for console display", () => {
    const t = loadValid();
    const preview = generatePreview(t);
    const formatted = formatPreview(preview);

    expect(formatted).toContain("Test Template");
    expect(formatted).toContain("Replaces: Test Product");
    expect(formatted).toContain("Autonomy: medium");
    expect(formatted).toContain("Security: hardened");
    expect(formatted).toContain("Local only:");
    expect(formatted).toContain("A day in the life:");
  });
});

// --- Mapper tests ---

describe("mapTemplateToConfig", () => {
  const baseAnswers: MapperAnswers = {
    agentName: "test-agent",
    timezone: "America/New_York",
    wakingHoursStart: "07:00",
    wakingHoursEnd: "22:00",
    integrations: [
      {
        provider: "telegram",
        category: "messaging",
        envVar: "TELEGRAM_BOT_TOKEN",
        credential: "test-token",
      },
    ],
    cloudProviders: [],
  };

  it("produces a valid DeploymentBundle", () => {
    const t = loadValid();
    const result = mapTemplateToConfig(t, baseAnswers);

    expect(result.validationPassed).toBe(true);
    expect(result.bundle.openclawConfig).toBeDefined();
    expect(result.bundle.envVars).toBeDefined();
    expect(result.bundle.dockerCompose).toBeTruthy();
    expect(result.bundle.identityFiles).toBeDefined();
    expect(result.bundle.cronJobs).toBeDefined();
  });

  it("sets mandatory security config (LM-01 through LM-05)", () => {
    const t = loadValid();
    const result = mapTemplateToConfig(t, baseAnswers);
    const config = result.bundle.openclawConfig;

    expect(config.dangerouslyDisableDeviceAuth).toBe(true);
    expect(config.allowedOrigins).toContain("http://localhost:18789");
    expect(config.trustedProxies).toContain("172.17.0.1");
    expect(config.tools?.exec?.host).toBe("gateway");
    expect(config.tools?.exec?.security).toBe("full");
  });

  it("generates identity files from template personality", () => {
    const t = loadValid();
    const result = mapTemplateToConfig(t, baseAnswers);
    const files = result.bundle.identityFiles;

    expect(files["SOUL.md"]).toContain("test-agent");
    expect(files["SOUL.md"]).toContain("direct");
    expect(files["SOUL.md"]).toContain("test partner");
    expect(files["HEARTBEAT.md"]).toContain("email");
    expect(files["HEARTBEAT.md"]).toContain("10min");
    expect(files["USER.md"]).toContain("User Context");
    expect(files["TOOLS.md"]).toContain("telegram");
  });

  it("generates cron jobs from template cron config", () => {
    const t = loadValid();
    const result = mapTemplateToConfig(t, baseAnswers);
    const jobs = result.bundle.cronJobs;

    expect(jobs.length).toBe(3);

    const heartbeat = jobs.find((j) => j.id === "heartbeat");
    expect(heartbeat).toBeDefined();
    if (heartbeat) {
      expect(heartbeat.expr).toContain("10");
      expect(heartbeat.enabled).toBe(true);
    }

    const morningBrief = jobs.find((j) => j.id === "morning-brief");
    expect(morningBrief).toBeDefined();
    if (morningBrief) {
      expect(morningBrief.expr).toBe("00 08 * * *");
    }
  });

  it("includes cloud provider config when provided", () => {
    const t = loadValid();
    const answersWithCloud: MapperAnswers = {
      ...baseAnswers,
      cloudProviders: [
        { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", credential: "sk-test" },
      ],
    };
    const result = mapTemplateToConfig(t, answersWithCloud);

    expect(result.bundle.openclawConfig.models?.providers?.["anthropic"]).toBeDefined();
    expect(result.bundle.envVars["ANTHROPIC_API_KEY"]).toBe("sk-test");
  });

  it("applies docker hardening matching template security posture", () => {
    const t = loadValid();
    const result = mapTemplateToConfig(t, baseAnswers);
    const compose = result.bundle.dockerCompose;

    expect(compose).toContain("cap_drop");
    expect(compose).toContain("ALL");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("no-new-privileges");
    expect(compose).toContain("user: 1000:1000");
  });

  it("maps all built-in templates to valid bundles", async () => {
    const templates = await loadBuiltInTemplates();

    for (const [, loadResult] of templates) {
      if (!loadResult.template) continue;
      const result = mapTemplateToConfig(loadResult.template, baseAnswers);
      expect(result.validationPassed).toBe(true);
    }
  });
});
