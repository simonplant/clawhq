/**
 * Template loader — reads and validates YAML template files.
 *
 * Loads templates from the built-in configs/templates/ directory or
 * from user-specified paths. Validates all required fields and enforces
 * Layer 1 security baselines (templates can tighten but never loosen).
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

import * as YAML from "yaml";

import type { TemplateChoice } from "../init/types.js";

import type {
  Template,
  TemplateLoadResult,
  TemplateValidationError,
} from "./types.js";
import {
  EGRESS_STRICTNESS,
  LAYER1_SECURITY_BASELINE,
  POSTURE_STRICTNESS,
} from "./types.js";

// --- Built-in templates directory ---

const __filename = fileURLToPath(import.meta.url);
const BUILT_IN_DIR = join(__filename, "..", "..", "..", "configs", "templates");

// --- Validation ---

const VALID_POSTURES = ["standard", "hardened", "paranoid"];
const VALID_EGRESS = ["default", "restricted", "allowlist-only"];
const VALID_SUMMARIZATION = ["aggressive", "balanced", "conservative"];
const VALID_AUTONOMY = ["low", "medium", "high"];
const VALID_QUALITY_THRESHOLD = ["low", "medium", "high"];
const VALID_DEFAULT_PROVIDER = ["local", "cloud"];

function validateTemplate(data: unknown): TemplateValidationError[] {
  const errors: TemplateValidationError[] = [];

  if (typeof data !== "object" || data === null) {
    errors.push({ field: "root", message: "Template must be an object" });
    return errors;
  }

  const t = data as Record<string, unknown>;

  // Required top-level strings
  requireString(t, "name", errors);
  requireString(t, "version", errors);

  // use_case_mapping
  const ucm = requireObject(t, "use_case_mapping", errors);
  if (ucm) {
    requireString(ucm, "replaces", errors, "use_case_mapping");
    requireString(ucm, "tagline", errors, "use_case_mapping");
    requireString(ucm, "description", errors, "use_case_mapping");
    requireString(ucm, "day_in_the_life", errors, "use_case_mapping");
  }

  // personality
  const p = requireObject(t, "personality", errors);
  if (p) {
    requireString(p, "tone", errors, "personality");
    requireString(p, "style", errors, "personality");
    requireString(p, "relationship", errors, "personality");
    requireString(p, "boundaries", errors, "personality");
  }

  // security_posture
  const sp = requireObject(t, "security_posture", errors);
  if (sp) {
    requireEnum(sp, "posture", VALID_POSTURES, errors, "security_posture");
    requireEnum(sp, "egress", VALID_EGRESS, errors, "security_posture");
    if (sp["identity_mount"] !== "read-only") {
      errors.push({
        field: "security_posture.identity_mount",
        message: 'identity_mount must be "read-only"',
      });
    }
  }

  // monitoring
  const mon = requireObject(t, "monitoring", errors);
  if (mon) {
    requireString(mon, "heartbeat_frequency", errors, "monitoring");
    requireStringArray(mon, "checks", errors, "monitoring");
    requireString(mon, "quiet_hours", errors, "monitoring");
    requireStringArray(mon, "alert_on", errors, "monitoring");
  }

  // memory_policy
  const mem = requireObject(t, "memory_policy", errors);
  if (mem) {
    requireString(mem, "hot_max", errors, "memory_policy");
    requireString(mem, "hot_retention", errors, "memory_policy");
    requireString(mem, "warm_retention", errors, "memory_policy");
    requireString(mem, "cold_retention", errors, "memory_policy");
    requireEnum(mem, "summarization", VALID_SUMMARIZATION, errors, "memory_policy");
  }

  // cron_config
  const cron = requireObject(t, "cron_config", errors);
  if (cron) {
    requireStringField(cron, "heartbeat", errors, "cron_config");
    requireStringField(cron, "work_session", errors, "cron_config");
    requireStringField(cron, "morning_brief", errors, "cron_config");
  }

  // autonomy_model
  const auto = requireObject(t, "autonomy_model", errors);
  if (auto) {
    requireEnum(auto, "default", VALID_AUTONOMY, errors, "autonomy_model");
    requireStringArray(auto, "requires_approval", errors, "autonomy_model");
  }

  // model_routing_strategy
  const mrs = requireObject(t, "model_routing_strategy", errors);
  if (mrs) {
    requireEnum(mrs, "default_provider", VALID_DEFAULT_PROVIDER, errors, "model_routing_strategy");
    requireString(mrs, "local_model_preference", errors, "model_routing_strategy");
    requireStringArray(mrs, "cloud_escalation_categories", errors, "model_routing_strategy");
    requireEnum(mrs, "quality_threshold", VALID_QUALITY_THRESHOLD, errors, "model_routing_strategy");
  }

  // integration_requirements
  const ir = requireObject(t, "integration_requirements", errors);
  if (ir) {
    requireStringArray(ir, "required", errors, "integration_requirements");
    requireStringArray(ir, "recommended", errors, "integration_requirements");
    requireStringArray(ir, "optional", errors, "integration_requirements");
  }

  // skill_bundle
  const sb = requireObject(t, "skill_bundle", errors);
  if (sb) {
    requireStringArray(sb, "included", errors, "skill_bundle");
    requireStringArray(sb, "recommended", errors, "skill_bundle");
  }

  // Layer 1 security baseline enforcement
  if (sp && errors.filter((e) => e.field.startsWith("security_posture")).length === 0) {
    const posture = sp["posture"] as string;
    const egress = sp["egress"] as string;

    if (POSTURE_STRICTNESS[posture as keyof typeof POSTURE_STRICTNESS] <
        POSTURE_STRICTNESS[LAYER1_SECURITY_BASELINE.posture]) {
      errors.push({
        field: "security_posture.posture",
        message: `Template posture "${posture}" is less strict than Layer 1 baseline "${LAYER1_SECURITY_BASELINE.posture}" — templates can tighten but never loosen security`,
      });
    }

    if (EGRESS_STRICTNESS[egress as keyof typeof EGRESS_STRICTNESS] <
        EGRESS_STRICTNESS[LAYER1_SECURITY_BASELINE.egress]) {
      errors.push({
        field: "security_posture.egress",
        message: `Template egress "${egress}" is less strict than Layer 1 baseline "${LAYER1_SECURITY_BASELINE.egress}" — templates can tighten but never loosen security`,
      });
    }
  }

  return errors;
}

// --- Validation helpers ---

function requireString(
  obj: Record<string, unknown>,
  field: string,
  errors: TemplateValidationError[],
  prefix?: string,
): void {
  const fullField = prefix ? `${prefix}.${field}` : field;
  if (typeof obj[field] !== "string" || (obj[field] as string).trim() === "") {
    errors.push({ field: fullField, message: `${field} is required and must be a non-empty string` });
  }
}

/** Like requireString but allows empty strings (for optional cron fields). */
function requireStringField(
  obj: Record<string, unknown>,
  field: string,
  errors: TemplateValidationError[],
  prefix?: string,
): void {
  const fullField = prefix ? `${prefix}.${field}` : field;
  if (obj[field] !== undefined && typeof obj[field] !== "string") {
    errors.push({ field: fullField, message: `${field} must be a string` });
  }
}

function requireObject(
  obj: Record<string, unknown>,
  field: string,
  errors: TemplateValidationError[],
): Record<string, unknown> | null {
  const val = obj[field];
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    errors.push({ field, message: `${field} is required and must be an object` });
    return null;
  }
  return val as Record<string, unknown>;
}

function requireEnum(
  obj: Record<string, unknown>,
  field: string,
  values: string[],
  errors: TemplateValidationError[],
  prefix?: string,
): void {
  const fullField = prefix ? `${prefix}.${field}` : field;
  const val = obj[field];
  if (typeof val !== "string" || !values.includes(val)) {
    errors.push({
      field: fullField,
      message: `${field} must be one of: ${values.join(", ")}`,
    });
  }
}

function requireStringArray(
  obj: Record<string, unknown>,
  field: string,
  errors: TemplateValidationError[],
  prefix?: string,
): void {
  const fullField = prefix ? `${prefix}.${field}` : field;
  const val = obj[field];
  if (!Array.isArray(val)) {
    errors.push({ field: fullField, message: `${field} is required and must be an array` });
    return;
  }
  for (let i = 0; i < val.length; i++) {
    if (typeof val[i] !== "string") {
      errors.push({ field: `${fullField}[${i}]`, message: `${field} items must be strings` });
    }
  }
}

// --- Loading ---

/** Load a single template from a YAML file path. */
export async function loadTemplate(filePath: string): Promise<TemplateLoadResult> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    return {
      template: null,
      errors: [{
        field: "file",
        message: `Cannot read template file: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }

  return loadTemplateFromString(content);
}

/** Load a template from a YAML string. */
export function loadTemplateFromString(yamlContent: string): TemplateLoadResult {
  let data: unknown;
  try {
    data = YAML.parse(yamlContent);
  } catch (err: unknown) {
    return {
      template: null,
      errors: [{
        field: "yaml",
        message: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }

  const errors = validateTemplate(data);
  if (errors.length > 0) {
    return { template: null, errors };
  }

  return { template: data as Template, errors: [] };
}

/** Load all built-in templates from configs/templates/. */
export async function loadBuiltInTemplates(): Promise<Map<string, TemplateLoadResult>> {
  return loadTemplatesFromDirectory(BUILT_IN_DIR);
}

/** Load all templates from a directory. */
export async function loadTemplatesFromDirectory(
  dirPath: string,
): Promise<Map<string, TemplateLoadResult>> {
  const results = new Map<string, TemplateLoadResult>();

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch (err: unknown) {
    results.set("_error", {
      template: null,
      errors: [{
        field: "directory",
        message: `Cannot read template directory: ${err instanceof Error ? err.message : String(err)}`,
      }],
    });
    return results;
  }

  const yamlFiles = entries
    .filter((f) => extname(f) === ".yaml" || extname(f) === ".yml")
    .sort();

  for (const file of yamlFiles) {
    const id = basename(file, extname(file));
    const result = await loadTemplate(join(dirPath, file));
    results.set(id, result);
  }

  return results;
}

/** Get the path to the built-in templates directory. */
export function getBuiltInTemplatesDir(): string {
  return BUILT_IN_DIR;
}

// --- Template → TemplateChoice conversion ---

/**
 * Convert a YAML Template (snake_case) to a TemplateChoice (camelCase)
 * compatible with the init wizard.
 */
export function templateToChoice(id: string, template: Template): TemplateChoice {
  return {
    id,
    name: template.name,
    description: template.use_case_mapping.description.trim(),
    useCase: template.use_case_mapping.tagline,
    personality: {
      tone: template.personality.tone,
      style: template.personality.style,
      relationship: template.personality.relationship,
      boundaries: template.personality.boundaries,
    },
    security: {
      posture: template.security_posture.posture,
      egress: template.security_posture.egress,
      identityMount: template.security_posture.identity_mount,
    },
    monitoring: {
      heartbeatFrequency: template.monitoring.heartbeat_frequency,
      checks: template.monitoring.checks,
      quietHours: template.monitoring.quiet_hours,
      alertOn: template.monitoring.alert_on,
    },
    memory: {
      hotMax: template.memory_policy.hot_max,
      hotRetention: template.memory_policy.hot_retention,
      warmRetention: template.memory_policy.warm_retention,
      coldRetention: template.memory_policy.cold_retention,
      summarization: template.memory_policy.summarization,
    },
    cron: {
      heartbeat: template.cron_config.heartbeat,
      workSession: template.cron_config.work_session,
      morningBrief: template.cron_config.morning_brief,
    },
    autonomy: {
      default: template.autonomy_model.default,
      requiresApproval: template.autonomy_model.requires_approval,
    },
    integrationsRequired: template.integration_requirements.required,
    integrationsRecommended: template.integration_requirements.recommended,
    skillsIncluded: template.skill_bundle.included,
  };
}

/**
 * Load all built-in templates and convert them to TemplateChoice objects
 * for use by the init wizard. This is the canonical way to get templates
 * for the wizard — YAML files are the single source of truth.
 */
export async function loadBuiltInTemplateChoices(): Promise<TemplateChoice[]> {
  const results = await loadBuiltInTemplates();
  const choices: TemplateChoice[] = [];

  for (const [id, result] of results) {
    if (id === "_error" || !result.template) continue;
    choices.push(templateToChoice(id, result.template));
  }

  return choices;
}
