/**
 * Template type definitions for YAML-based operational profiles.
 *
 * Templates are full operational profiles — like WordPress themes for agents.
 * Each template maps a use-case ("Replace Google Assistant") to operational
 * dimensions (personality, security, monitoring, etc.).
 *
 * See OPENCLAW-REFERENCE.md → Template System Design.
 */

// --- Template sub-types ---

export interface TemplatePersonality {
  tone: string;
  style: string;
  relationship: string;
  boundaries: string;
}

export interface TemplateSecurityPosture {
  posture: "standard" | "hardened" | "paranoid";
  egress: "default" | "restricted" | "allowlist-only";
  identity_mount: "read-only";
}

export interface TemplateMonitoring {
  heartbeat_frequency: string;
  checks: string[];
  quiet_hours: string;
  alert_on: string[];
}

export interface TemplateMemoryPolicy {
  hot_max: string;
  hot_retention: string;
  warm_retention: string;
  cold_retention: string;
  summarization: "aggressive" | "balanced" | "conservative";
}

export interface TemplateCronConfig {
  heartbeat: string;
  work_session: string;
  morning_brief: string;
}

export interface TemplateAutonomyModel {
  default: "low" | "medium" | "high";
  requires_approval: string[];
}

export interface TemplateModelRoutingStrategy {
  default_provider: "local" | "cloud";
  local_model_preference: string;
  cloud_escalation_categories: string[];
  quality_threshold: "low" | "medium" | "high";
}

export interface TemplateIntegrationRequirements {
  required: string[];
  recommended: string[];
  optional: string[];
}

export interface TemplateSkillBundle {
  included: string[];
  recommended: string[];
}

export interface TemplateChannels {
  supported: string[];
  default: string;
}

// --- Main Template type ---

export interface Template {
  name: string;
  version: string;
  use_case_mapping: {
    replaces: string;
    tagline: string;
    description: string;
    day_in_the_life: string;
  };
  personality: TemplatePersonality;
  security_posture: TemplateSecurityPosture;
  monitoring: TemplateMonitoring;
  memory_policy: TemplateMemoryPolicy;
  cron_config: TemplateCronConfig;
  autonomy_model: TemplateAutonomyModel;
  model_routing_strategy: TemplateModelRoutingStrategy;
  integration_requirements: TemplateIntegrationRequirements;
  skill_bundle: TemplateSkillBundle;
  channels?: TemplateChannels;
}

// --- Layer 1 security baselines (templates can tighten, never loosen) ---

export const LAYER1_SECURITY_BASELINE: TemplateSecurityPosture = {
  posture: "standard",
  egress: "default",
  identity_mount: "read-only",
};

/** Posture strictness ordering for enforcement. */
export const POSTURE_STRICTNESS: Record<TemplateSecurityPosture["posture"], number> = {
  standard: 0,
  hardened: 1,
  paranoid: 2,
};

/** Egress strictness ordering for enforcement. */
export const EGRESS_STRICTNESS: Record<TemplateSecurityPosture["egress"], number> = {
  default: 0,
  restricted: 1,
  "allowlist-only": 2,
};

// --- Template preview info ---

export interface TemplatePreview {
  name: string;
  replaces: string;
  tagline: string;
  description: string;
  dayInTheLife: string;
  integrationsRequired: string[];
  integrationsRecommended: string[];
  autonomyLevel: string;
  approvalRequired: string[];
  securityPosture: string;
  localModelRequirements: string;
  estimatedDailyCost: {
    localOnly: string;
    withCloud: string;
  };
  skillsIncluded: string[];
  channels?: TemplateChannels;
}

// --- Validation result ---

export interface TemplateValidationError {
  field: string;
  message: string;
}

export interface TemplateLoadResult {
  template: Template | null;
  errors: TemplateValidationError[];
}
