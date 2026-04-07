import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { parse as parseYaml } from "yaml";

import { templateToChoice, allTemplatesToChoices } from "./choice.js";
import {
  BlueprintLoadError,
  BlueprintParseError,
  BlueprintSizeError,
  BlueprintValidationError,
  listBuiltinBlueprints,
  loadAllBuiltinBlueprints,
  loadBlueprint,
  loadBlueprintFile,
} from "./loader.js";
import { validateBlueprint } from "./validate.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal valid blueprint YAML. */
const VALID_BLUEPRINT_YAML = `
name: Test Blueprint
version: "1.0.0"

use_case_mapping:
  replaces: Test Tool
  tagline: "A test blueprint for validation"
  description: "Test blueprint that validates the loader works correctly."
  day_in_the_life: "You wake up and your tests pass."

personality:
  tone: direct
  style: "precise and focused"
  relationship: assistant
  boundaries: "stays on task"

security_posture:
  posture: hardened
  egress: restricted
  egress_domains:
    - imap.gmail.com
    - smtp.gmail.com
  identity_mount: read-only

monitoring:
  heartbeat_frequency: "10min"
  checks:
    - email
  quiet_hours: "22:00-06:00"
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
    - account_changes
  delegation:
    - action: read_data
      tier: execute
      example: "Read and process incoming information"
    - action: draft_response
      tier: propose
      example: "Draft a response for user review"
    - action: modify_settings
      tier: approve
      example: "Change account settings — user must request"

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

channels:
  supported:
    - telegram
    - discord
  default: telegram

skill_bundle:
  included:
    - morning-brief
  recommended:
    - email-triage

toolbelt:
  role: "Test assistant"
  description: "A test toolbelt for validation"
  tools:
    - name: email
      category: email
      required: true
      description: "Email tool"
    - name: tasks
      category: core
      required: true
      description: "Task queue"
  skills:
    - name: morning-brief
      required: true
      description: "Daily morning briefing"
`;

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "clawhq-blueprint-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeBlueprint(filename: string, content: string): string {
  const path = join(tempDir, filename);
  writeFileSync(path, content, "utf-8");
  return path;
}

// ── Loading Tests ───────────────────────────────────────────────────────────

describe("loadBlueprintFile", () => {
  it("loads a valid blueprint YAML", () => {
    const path = writeBlueprint("test.yaml", VALID_BLUEPRINT_YAML);
    const blueprint = loadBlueprintFile(path);
    expect(blueprint.name).toBe("Test Blueprint");
    expect(blueprint.version).toBe("1.0.0");
    expect(blueprint.use_case_mapping.replaces).toBe("Test Tool");
    expect(blueprint.toolbelt.tools).toHaveLength(2);
    expect(blueprint.toolbelt.skills).toHaveLength(1);
  });

  it("throws BlueprintLoadError for missing file", () => {
    expect(() => loadBlueprintFile("/nonexistent/path.yaml")).toThrow(
      BlueprintLoadError,
    );
  });

  it("throws BlueprintSizeError for oversized file", () => {
    // Create a file > 256KB
    const largeContent = "name: big\n" + "x: " + "a".repeat(300 * 1024) + "\n";
    const path = writeBlueprint("large.yaml", largeContent);
    expect(() => loadBlueprintFile(path)).toThrow(BlueprintSizeError);
  });

  it("throws BlueprintParseError for invalid YAML", () => {
    const path = writeBlueprint("bad.yaml", "{{invalid: yaml: [}");
    expect(() => loadBlueprintFile(path)).toThrow(BlueprintParseError);
  });

  it("throws BlueprintParseError for empty file", () => {
    const path = writeBlueprint("empty.yaml", "");
    expect(() => loadBlueprintFile(path)).toThrow(BlueprintParseError);
  });

  it("throws BlueprintParseError for array YAML", () => {
    const path = writeBlueprint("array.yaml", "- item1\n- item2");
    expect(() => loadBlueprintFile(path)).toThrow(BlueprintParseError);
  });

  it("throws BlueprintValidationError for structurally invalid blueprint", () => {
    const path = writeBlueprint("invalid.yaml", "name: Missing Everything\n");
    expect(() => loadBlueprintFile(path)).toThrow(BlueprintValidationError);
  });

  it("includes readable error messages in validation errors", () => {
    const path = writeBlueprint("bad-struct.yaml", "name: Bad\nversion: '1.0.0'\n");
    try {
      loadBlueprintFile(path);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BlueprintValidationError);
      const ve = err as BlueprintValidationError;
      expect(ve.errors.length).toBeGreaterThan(0);
      expect(ve.message).toContain("Missing required section");
    }
  });
});

// ── Multi-Path Loading Tests ────────────────────────────────────────────────

describe("loadBlueprint", () => {
  it("loads by direct file path", () => {
    const path = writeBlueprint("direct.yaml", VALID_BLUEPRINT_YAML);
    const loaded = loadBlueprint(path);
    expect(loaded.blueprint.name).toBe("Test Blueprint");
    expect(loaded.sourcePath).toBe(path);
    expect(loaded.isBuiltin).toBe(false);
  });

  it("throws for nonexistent name with helpful message", () => {
    try {
      loadBlueprint("nonexistent-blueprint");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BlueprintLoadError);
      expect((err as Error).message).toContain("not found");
      expect((err as Error).message).toContain("Searched");
    }
  });
});

// ── Built-in Blueprint Tests ────────────────────────────────────────────────

describe("listBuiltinBlueprints", () => {
  it("returns sorted list of built-in blueprint names", () => {
    const names = listBuiltinBlueprints();
    expect(names.length).toBeGreaterThanOrEqual(6);
    expect(names).toContain("family-hub");
    expect(names).toContain("founders-ops");
    expect(names).toContain("replace-google-assistant");
    // Verify sorted
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe("loadAllBuiltinBlueprints", () => {
  it("loads all built-in blueprints without errors", () => {
    const loaded = loadAllBuiltinBlueprints();
    expect(loaded.length).toBeGreaterThanOrEqual(6);

    for (const { blueprint, isBuiltin } of loaded) {
      expect(isBuiltin).toBe(true);
      expect(blueprint.name).toBeTruthy();
      expect(blueprint.version).toBeTruthy();
    }
  });

  it("all built-in blueprints have valid structure", () => {
    const names = listBuiltinBlueprints();

    for (const name of names) {
      const loaded = loadBlueprint(name);
      expect(loaded.blueprint.name).toBeTruthy();
      expect(loaded.blueprint.security_posture.identity_mount).toBe("read-only");
    }
  });
});

// ── Validation Tests ────────────────────────────────────────────────────────

describe("validateBlueprint", () => {
  it("passes a valid blueprint", () => {
    const raw = parseYaml(VALID_BLUEPRINT_YAML) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.blueprintName).toBe("Test Blueprint");
  });

  it("produces 70+ checks for a complete blueprint", () => {
    const raw = parseYaml(VALID_BLUEPRINT_YAML) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    expect(report.results.length).toBeGreaterThanOrEqual(70);
  });

  it("reports missing name", () => {
    const report = validateBlueprint({ version: "1.0.0" });
    const nameCheck = report.results.find((r) => r.check === "blueprint.name");
    expect(nameCheck?.passed).toBe(false);
  });

  it("reports missing required sections", () => {
    const report = validateBlueprint({ name: "X", version: "1.0.0" });
    const sectionErrors = report.errors.filter((e) => e.check.startsWith("section."));
    expect(sectionErrors.length).toBe(12); // All 12 required sections
  });

  it("validates security posture enum values", () => {
    const yaml = VALID_BLUEPRINT_YAML.replace("posture: hardened", "posture: invalid");
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const postureCheck = report.results.find(
      (r) => r.check === "security_posture.posture",
    );
    expect(postureCheck?.passed).toBe(false);
    expect(postureCheck?.message).toContain("invalid");
  });

  it("validates channel default is in supported list", () => {
    const yaml = VALID_BLUEPRINT_YAML.replace("default: telegram", "default: whatsapp");
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const channelCheck = report.results.find(
      (r) => r.check === "channels.default_in_supported",
    );
    expect(channelCheck?.passed).toBe(false);
    expect(channelCheck?.message).toContain("whatsapp");
  });

  it("validates tool entries have required fields", () => {
    const yaml = VALID_BLUEPRINT_YAML.replace(
      "    - name: email\n      category: email\n      required: true\n      description: \"Email tool\"",
      "    - name: email",
    );
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const toolErrors = report.errors.filter((e) =>
      e.check.startsWith("toolbelt.tools[0]"),
    );
    expect(toolErrors.length).toBeGreaterThan(0);
  });

  it("detects duplicate tool names", () => {
    const yaml = VALID_BLUEPRINT_YAML.replace(
      "    - name: tasks\n      category: core\n      required: true\n      description: \"Task queue\"",
      "    - name: email\n      category: core\n      required: true\n      description: \"Duplicate\"",
    );
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const dupeCheck = report.results.find(
      (r) => r.check === "cross.unique_tool_names",
    );
    expect(dupeCheck?.passed).toBe(false);
    expect(dupeCheck?.message).toContain("email");
  });

  it("rejects invalid security posture", () => {
    const yaml = VALID_BLUEPRINT_YAML.replace("posture: hardened", "posture: standard");
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const postureCheck = report.results.find(
      (r) => r.check === "security_posture.posture",
    );
    expect(postureCheck?.passed).toBe(false);
  });

  it("enforces identity_mount read-only", () => {
    const raw = parseYaml(VALID_BLUEPRINT_YAML) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const idCheck = report.results.find(
      (r) => r.check === "security.identity_mount_readonly",
    );
    expect(idCheck?.passed).toBe(true);
  });

  it("validates cron_config.model_routing with known models", () => {
    const yaml = VALID_BLUEPRINT_YAML.replace(
      'cron_config:\n  heartbeat: "*/10 waking"\n  work_session: "*/15 waking"\n  morning_brief: "08:00"',
      'cron_config:\n  heartbeat: "*/10 waking"\n  work_session: "*/15 waking"\n  morning_brief: "08:00"\n  model_routing:\n    heartbeat:\n      model: haiku\n      fallbacks:\n        - sonnet\n    work_session:\n      model: opus\n      fallbacks:\n        - sonnet',
    );
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    expect(report.valid).toBe(true);
    const modelChecks = report.results.filter((r) => r.check.includes("model_routing"));
    expect(modelChecks.length).toBeGreaterThan(0);
    expect(modelChecks.every((r) => r.passed)).toBe(true);
  });

  it("rejects unknown model in cron_config.model_routing", () => {
    const yaml = VALID_BLUEPRINT_YAML.replace(
      'cron_config:\n  heartbeat: "*/10 waking"\n  work_session: "*/15 waking"\n  morning_brief: "08:00"',
      'cron_config:\n  heartbeat: "*/10 waking"\n  work_session: "*/15 waking"\n  morning_brief: "08:00"\n  model_routing:\n    heartbeat:\n      model: nonexistent-model',
    );
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const modelCheck = report.errors.find((r) => r.check.includes("model_routing.heartbeat.model"));
    expect(modelCheck).toBeDefined();
    expect(modelCheck?.message).toContain("nonexistent-model");
  });

  it("rejects unknown model in fallbacks array", () => {
    const yaml = VALID_BLUEPRINT_YAML.replace(
      'cron_config:\n  heartbeat: "*/10 waking"\n  work_session: "*/15 waking"\n  morning_brief: "08:00"',
      'cron_config:\n  heartbeat: "*/10 waking"\n  work_session: "*/15 waking"\n  morning_brief: "08:00"\n  model_routing:\n    heartbeat:\n      model: haiku\n      fallbacks:\n        - fake-model',
    );
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const fbCheck = report.errors.find((r) => r.check.includes("fallbacks"));
    expect(fbCheck).toBeDefined();
    expect(fbCheck?.message).toContain("fake-model");
  });

  it("accepts valid profile_ref", () => {
    const yaml = VALID_BLUEPRINT_YAML.replace(
      'version: "1.0.0"',
      'version: "1.0.0"\nprofile_ref: lifeops',
    );
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const profileCheck = report.results.find((r) => r.check === "cross.profile_ref_valid");
    expect(profileCheck).toBeDefined();
    expect(profileCheck?.passed).toBe(true);
  });

  it("warns on invalid profile_ref", () => {
    const yaml = VALID_BLUEPRINT_YAML.replace(
      'version: "1.0.0"',
      'version: "1.0.0"\nprofile_ref: nonexistent',
    );
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const profileCheck = report.warnings.find((r) => r.check === "cross.profile_ref_valid");
    expect(profileCheck).toBeDefined();
    expect(profileCheck?.message).toContain("nonexistent");
  });

  it("warns when toolbelt references a tool denied by its profile", () => {
    // Add profile_ref: lifeops (denies browser) and a tool named "browser" in the toolbelt
    const yaml = VALID_BLUEPRINT_YAML
      .replace('version: "1.0.0"', 'version: "1.0.0"\nprofile_ref: lifeops')
      .replace(
        "    - name: email\n      category: email\n      required: true\n      description: \"Email tool\"",
        "    - name: email\n      category: email\n      required: true\n      description: \"Email tool\"\n    - name: browser\n      category: web\n      required: false\n      description: \"Web browser\"",
      );
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const deniedCheck = report.warnings.find((r) => r.check === "cross.toolbelt_denied_tool.browser");
    expect(deniedCheck).toBeDefined();
    expect(deniedCheck?.message).toContain("denied by profile");
  });

  it("does not warn when toolbelt tools are not in profile deny list", () => {
    const yaml = VALID_BLUEPRINT_YAML.replace(
      'version: "1.0.0"',
      'version: "1.0.0"\nprofile_ref: dev',
    );
    const raw = parseYaml(yaml) as Record<string, unknown>;
    const report = validateBlueprint(raw);
    const noConflict = report.results.find((r) => r.check === "cross.toolbelt_denied_tools");
    expect(noConflict).toBeDefined();
    expect(noConflict?.passed).toBe(true);
  });
});

// ── templateToChoice Tests ──────────────────────────────────────────────────

describe("templateToChoice", () => {
  it("produces correct wizard display data", () => {
    const path = writeBlueprint("choice.yaml", VALID_BLUEPRINT_YAML);
    const { blueprint } = loadBlueprint(path);
    const choice = templateToChoice(blueprint);

    expect(choice.name).toBe("Test Blueprint");
    expect(choice.value).toBe("test-blueprint");
    expect(choice.tagline).toBe("A test blueprint for validation");
    expect(choice.replaces).toBe("Test Tool");
    expect(choice.requiredIntegrations).toEqual(["messaging"]);
    expect(choice.recommendedIntegrations).toEqual(["email"]);
    expect(choice.includedSkills).toEqual(["morning-brief"]);
    expect(choice.channels).toEqual(["telegram", "discord"]);
    expect(choice.securityPosture).toBe("hardened");
    expect(choice.autonomyLevel).toBe("medium");
  });

  it("description is trimmed", () => {
    const path = writeBlueprint("trimtest.yaml", VALID_BLUEPRINT_YAML);
    const { blueprint } = loadBlueprint(path);
    const choice = templateToChoice(blueprint);
    expect(choice.description).not.toMatch(/^\s/);
    expect(choice.description).not.toMatch(/\s$/);
  });
});

describe("allTemplatesToChoices", () => {
  it("converts all built-in blueprints to sorted choices", () => {
    const loaded = loadAllBuiltinBlueprints();
    const choices = allTemplatesToChoices(loaded);

    expect(choices.length).toBe(loaded.length);
    // Verify sorted by name
    for (let i = 1; i < choices.length; i++) {
      expect(choices[i].name.localeCompare(choices[i - 1].name)).toBeGreaterThanOrEqual(0);
    }
    // Each choice has required fields
    for (const choice of choices) {
      expect(choice.name).toBeTruthy();
      expect(choice.value).toBeTruthy();
      expect(choice.tagline).toBeTruthy();
      expect(choice.channels.length).toBeGreaterThan(0);
    }
  });
});
