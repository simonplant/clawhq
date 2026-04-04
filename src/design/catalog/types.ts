/**
 * Types for mission profiles and personality presets.
 *
 * Mission profile = WHAT the agent does (tools, cron, integrations, autonomy)
 * Personality preset = HOW the agent does it (tone, values, voice, anti-patterns)
 * Composition = profile + personality + user overrides → compiled workspace
 */

import type { PersonalityDimensions } from "../blueprints/types.js";

// ── Mission Profile ─────────────────────────────────────────────────────────

export interface ProfileTool {
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly required: boolean;
}

export interface ProfileDelegation {
  readonly action: string;
  readonly tier: "execute" | "propose" | "approve";
  readonly example: string;
}

export interface MissionProfile {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly replaces: string;
  readonly tools: readonly ProfileTool[];
  readonly skills: readonly string[];
  readonly integrations: {
    readonly required: readonly string[];
    readonly recommended: readonly string[];
    readonly optional: readonly string[];
  };
  readonly cron_defaults: Readonly<Record<string, string>>;
  readonly cron_prompts: Readonly<Record<string, string>>;
  readonly delegation: readonly ProfileDelegation[];
  readonly egress_domains: readonly string[];
  readonly security_posture: "standard" | "hardened" | "paranoid";
  readonly autonomy_default: "low" | "medium" | "high";
  readonly memory_policy: {
    readonly hot_max: string;
    readonly hot_retention: string;
    readonly warm_retention: string;
    readonly cold_retention: string;
    readonly summarization: string;
  };
  readonly monitoring: {
    readonly heartbeat_frequency: string;
    readonly checks: readonly string[];
    readonly quiet_hours: string;
    readonly alert_on: readonly string[];
  };
  readonly day_in_the_life: string;
}

// ── Personality Preset ──────────────────────────────────────────────────────

export interface PersonalityPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly dimensions: PersonalityDimensions;
  readonly voice_examples: readonly string[];
  readonly anti_patterns: readonly string[];
  readonly identity: {
    readonly emoji: string;
    readonly vibe: string;
  };
  readonly values: string;
  readonly boundaries: string;
}

// ── Composition ─────────────────────────────────────────────────────────────

/** User-provided composition config (from YAML config file). */
export interface CompositionConfig {
  readonly profile: string;
  readonly personality: string;
  readonly dimension_overrides?: Partial<PersonalityDimensions>;
  readonly soul_overrides?: string;
  readonly extra_tools?: readonly string[];
}

/** User context from config file. */
export interface UserConfig {
  readonly name: string;
  readonly timezone: string;
  readonly communication: "brief" | "detailed" | "conversational";
  readonly constraints?: string;
}

/** A single file to be written to the deployment directory. */
export interface CompiledFile {
  readonly relativePath: string;
  readonly content: string;
  readonly mode?: number;
}

/** Complete compiled output from the composition. */
export interface CompiledWorkspace {
  readonly files: readonly CompiledFile[];
  readonly profile: MissionProfile;
  readonly personality: PersonalityPreset;
}
