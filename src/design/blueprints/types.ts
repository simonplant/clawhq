/**
 * Blueprint type definitions.
 *
 * These types define the schema for blueprint YAML files — complete agent
 * designs that configure every dimension of OpenClaw for a specific job.
 * Both built-in and community blueprints must conform to this schema.
 */

import type { DelegatedActionRules } from "./delegation-types.js";

// ── Blueprint Sections ──────────────────────────────────────────────────────

/** What the blueprint replaces and how it positions itself. */
export interface UseCaseMapping {
  readonly replaces: string;
  readonly tagline: string;
  readonly description: string;
  readonly day_in_the_life: string;
}

/** Valid dimension scale value (1-5). */
export type DimensionValue = 1 | 2 | 3 | 4 | 5;

/** Dimension identifiers for the personality system. */
export type DimensionId = "directness" | "warmth" | "verbosity"
  | "proactivity" | "caution" | "formality" | "analyticalDepth";

/** All 7 required dimension keys. */
const DIMENSION_KEYS: readonly DimensionId[] = [
  "directness", "warmth", "verbosity",
  "proactivity", "caution", "formality", "analyticalDepth",
];

/** Slider-based personality dimensions (7 dimensions, 1-5 scale). */
export interface PersonalityDimensions {
  readonly directness: DimensionValue;
  readonly warmth: DimensionValue;
  readonly verbosity: DimensionValue;
  readonly proactivity: DimensionValue;
  readonly caution: DimensionValue;
  readonly formality: DimensionValue;
  readonly analyticalDepth: DimensionValue;
}

/**
 * Parse and validate a raw record into PersonalityDimensions.
 *
 * Validates: all 7 required keys present, no extra keys, each value integer 1-5.
 * @throws Error listing all invalid/missing fields
 */
export function parseDimensions(input: Record<string, number>): PersonalityDimensions {
  const errors: string[] = [];

  // Check for missing keys
  const inputKeys = new Set(Object.keys(input));
  const requiredKeys = new Set<string>(DIMENSION_KEYS);

  for (const key of DIMENSION_KEYS) {
    if (!(key in input)) {
      errors.push(`missing key: ${key}`);
    } else {
      const val = input[key];
      if (!Number.isInteger(val) || val < 1 || val > 5) {
        errors.push(`${key}: value must be an integer 1-5 (got ${val})`);
      }
    }
  }

  // Check for extra keys
  for (const key of inputKeys) {
    if (!requiredKeys.has(key)) {
      errors.push(`unknown key: ${key}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid personality dimensions: ${errors.join("; ")}`);
  }

  return input as unknown as PersonalityDimensions;
}

/**
 * Agent personality configuration.
 *
 * Prose-only fields. Blueprints do NOT carry a dimension vector —
 * every agent uses the canonical ClawHQ personality (see
 * `CANONICAL_DIMENSIONS` in personality-presets.ts). Users customize
 * via `soul_overrides` free text.
 */
export interface Personality {
  readonly tone: string;
  readonly style: string;
  readonly relationship: string;
  readonly boundaries: string;
}

/** Security posture for the agent. */
export interface BlueprintSecurityPosture {
  readonly posture: "hardened" | "under-attack";
  readonly egress: "default" | "restricted" | "allowlist-only";
  readonly egress_domains: readonly string[];
  readonly identity_mount: "read-only";
}

/** Health monitoring configuration. */
export interface Monitoring {
  readonly heartbeat_frequency: string;
  readonly checks: readonly string[];
  readonly quiet_hours: string;
  readonly alert_on: readonly string[];
}

/** Memory tier and retention policy. */
export interface MemoryPolicy {
  readonly hot_max: string;
  readonly hot_retention: string;
  readonly warm_retention: string;
  readonly cold_retention: string;
  readonly summarization: "aggressive" | "balanced" | "conservative";
}

/** Per-job model routing — which model to use and fallback chain. */
export interface CronModelRouting {
  readonly model: string;
  readonly fallbacks?: readonly string[];
}

/** Cron delivery mode. */
export type BlueprintCronDelivery = "announce" | "none" | "errors";

/** Cron session target. */
export type BlueprintSessionTarget = "main" | "isolated";

/** Cron schedule configuration with optional per-job model routing, delivery, and session target. */
export interface CronConfig {
  readonly heartbeat: string;
  readonly work_session: string;
  readonly morning_brief: string;
  readonly model_routing?: {
    readonly heartbeat?: CronModelRouting;
    readonly work_session?: CronModelRouting;
    readonly morning_brief?: CronModelRouting;
  };
  readonly delivery?: {
    readonly heartbeat?: BlueprintCronDelivery;
    readonly work_session?: BlueprintCronDelivery;
    readonly morning_brief?: BlueprintCronDelivery;
  };
  readonly session_target?: {
    readonly heartbeat?: BlueprintSessionTarget;
    readonly work_session?: BlueprintSessionTarget;
    readonly morning_brief?: BlueprintSessionTarget;
  };
}

/** Delegation tier — controls whether the agent acts, proposes, or waits. */
export type DelegationTier = "execute" | "propose" | "approve";

/** A single per-action delegation rule with a concrete example. */
export interface DelegationRule {
  /** Action category (e.g. "archive_email", "send_reply"). */
  readonly action: string;
  /** Which tier this action falls into. */
  readonly tier: DelegationTier;
  /** Concrete example the LLM can reference at runtime. */
  readonly example: string;
}

/** Autonomy model — what the agent does alone vs. asks permission. */
export interface AutonomyModel {
  readonly default: "low" | "medium" | "high";
  readonly requires_approval: readonly string[];
  /** Per-action delegation rules with concrete examples. */
  readonly delegation?: readonly DelegationRule[];
}

/** Model routing strategy for local vs. cloud. */
export interface ModelRoutingStrategy {
  readonly default_provider: "local" | "cloud";
  /** Override the global default Ollama model. Omit to inherit OLLAMA_DEFAULT_MODEL. */
  readonly local_model_preference?: string;
  readonly quality_threshold: "low" | "medium" | "high";
}

/** Integration requirements by priority. */
export interface IntegrationRequirements {
  readonly required: readonly string[];
  readonly recommended: readonly string[];
  readonly optional: readonly string[];
}

/** Messaging channel configuration. */
export interface Channels {
  readonly supported: readonly string[];
  readonly default: string;
}

/** Skill bundle — included and recommended skills. */
export interface SkillBundle {
  readonly included: readonly string[];
  readonly recommended: readonly string[];
}

/**
 * 1Password vault integration configuration.
 *
 * When enabled, the agent container gets the op CLI installed and
 * credentials are fetched at runtime via `claw-secret` (wrapping `op read`).
 * The service account token is injected via Docker secret, never in env vars.
 */
export interface OnePasswordConfig {
  /** Whether 1Password vault integration is enabled. */
  readonly enabled: boolean;
  /** Name of the 1Password vault containing agent credentials. */
  readonly vault: string;
  /**
   * Credential mapping: logical name → 1Password secret reference.
   * Example: { "anthropic_api_key": "op://Agent-Vault/anthropic/credential" }
   */
  readonly credentials: Readonly<Record<string, string>>;
}

/** A domain-specific runbook — additional identity file defined by a blueprint. */
export interface RunbookEntry {
  /** Filename (e.g. "ESCALATION.md"). Must end in .md. */
  readonly name: string;

  /** Runbook content — domain-specific operating procedures. */
  readonly content: string;
}

/** Individual tool in the toolbelt. */
export interface ToolEntry {
  readonly name: string;
  readonly category: string;
  readonly required: boolean;
  readonly description: string;
}

/** Individual skill in the toolbelt. */
export interface SkillEntry {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
}

/** Agent's toolbelt — tools and skills. */
export interface Toolbelt {
  readonly role: string;
  readonly description: string;
  readonly tools: readonly ToolEntry[];
  readonly skills: readonly SkillEntry[];
  /** Additional tools to deny beyond profile defaults (optional). */
  readonly deny?: readonly string[];
  /** Tools to explicitly allow, overriding profile deny (optional). Deny-wins: if a tool appears in both deny and allow, it stays denied. */
  readonly allow?: readonly string[];
}

/** A single customization question asked during setup. */
export interface CustomizationQuestion {
  /** Unique identifier for this question (used as key in answers). */
  readonly id: string;

  /** The prompt shown to the user. */
  readonly prompt: string;

  /** Question type: "select" shows choices, "input" accepts free text. */
  readonly type: "select" | "input";

  /** Available choices (required when type is "select"). */
  readonly options?: readonly string[];

  /** Default value (first option for select, empty for input). */
  readonly default?: string;
}

// ── Complete Blueprint ──────────────────────────────────────────────────────

/**
 * Complete blueprint schema.
 *
 * Every field maps to a section of the blueprint YAML. The loader validates
 * that all required sections are present and structurally correct.
 */
export interface Blueprint {
  readonly name: string;
  readonly version: string;
  readonly use_case_mapping: UseCaseMapping;
  readonly personality: Personality;
  readonly security_posture: BlueprintSecurityPosture;

  /** Optional mission profile reference — drives default tool deny list and recommended integrations. */
  readonly profile_ref?: string;
  readonly monitoring: Monitoring;
  readonly memory_policy: MemoryPolicy;
  readonly cron_config: CronConfig;
  readonly autonomy_model: AutonomyModel;
  readonly model_routing_strategy: ModelRoutingStrategy;
  readonly integration_requirements: IntegrationRequirements;
  readonly channels: Channels;
  readonly skill_bundle: SkillBundle;
  readonly toolbelt: Toolbelt;

  /** Optional customization questions asked during setup (1-3 per blueprint). */
  readonly customization_questions?: readonly CustomizationQuestion[];

  /** Optional 1Password vault integration configuration. */
  readonly onepassword?: OnePasswordConfig;

  /** Optional domain-specific runbooks — additional identity files for the agent. */
  readonly runbooks?: readonly RunbookEntry[];

  /** Optional delegated action rules — pre-approved action categories with pattern matching. */
  readonly delegation_rules?: DelegatedActionRules;
}

// ── Validation Types ────────────────────────────────────────────────────────

/** Severity of a blueprint validation finding. */
export type BlueprintValidationSeverity = "error" | "warning";

/** Single validation result from a blueprint check. */
export interface BlueprintValidationResult {
  readonly check: string;
  readonly passed: boolean;
  readonly severity: BlueprintValidationSeverity;
  readonly message: string;
}

/** Aggregate result from running all blueprint validation checks. */
export interface BlueprintValidationReport {
  readonly valid: boolean;
  readonly blueprintName: string;
  readonly results: readonly BlueprintValidationResult[];
  readonly errors: readonly BlueprintValidationResult[];
  readonly warnings: readonly BlueprintValidationResult[];
}

// ── Choice Types (for wizard display) ───────────────────────────────────────

/** Blueprint choice for the init wizard / blueprint list display. */
export interface BlueprintChoice {
  readonly name: string;
  readonly value: string;
  readonly description: string;
  readonly tagline: string;
  readonly replaces: string;
  readonly requiredIntegrations: readonly string[];
  readonly recommendedIntegrations: readonly string[];
  readonly includedSkills: readonly string[];
  readonly channels: readonly string[];
  readonly securityPosture: string;
  readonly autonomyLevel: string;
}
