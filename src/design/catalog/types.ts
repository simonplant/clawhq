/**
 * Types for mission profiles and the canonical personality.
 *
 * Mission profile  = WHAT the agent does (tools, cron, integrations, autonomy)
 * Canonical
 * personality      = HOW the agent does it — a single shipped tone ("LifeOps,
 *                    no BS") expressed through voice examples, anti-patterns,
 *                    values, and boundaries. Not user-configurable.
 * Composition      = profile + providers + soul_overrides → compiled workspace
 */

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
  readonly cron_defaults: Readonly<Record<string, string | { expr: string; announce?: boolean }>>;
  readonly cron_prompts: Readonly<Record<string, string>>;
  readonly delegation: readonly ProfileDelegation[];
  readonly egress_domains: readonly string[];
  readonly security_posture: "hardened" | "under-attack";
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

// ── Canonical Personality ───────────────────────────────────────────────────

/**
 * The single canonical ClawHQ personality.
 *
 * Dimensions come from `CANONICAL_DIMENSIONS` in personality-presets.ts —
 * this type carries the prose content (voice, anti-patterns, values,
 * boundaries, identity) that shapes SOUL.md alongside the dimension prose.
 */
export interface CanonicalPersonality {
  readonly id: string;
  readonly name: string;
  readonly description: string;
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

/**
 * User-provided composition config (from YAML config file).
 *
 * Personality is NOT a field here — every agent uses the canonical
 * ClawHQ personality (see CANONICAL_DIMENSIONS). Users customize tone
 * via `soul_overrides` free text only.
 */
export interface CompositionConfig {
  readonly profile: string;
  readonly providers?: Readonly<Record<string, string>>;
  readonly channels?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly soul_overrides?: string;
  readonly extra_tools?: readonly string[];
  /** Override the default model (provider-prefixed, e.g. "ollama/<tag>" or "anthropic/<model>"). */
  readonly model?: string;
  /** Override the model's contextWindow in openclaw.json (caps KV cache / VRAM). */
  readonly modelContextWindow?: number;
  /** Override fallback models (ollama-prefixed strings). */
  readonly modelFallbacks?: readonly string[];
}

/** User context from config file. */
export interface UserConfig {
  readonly name: string;
  readonly timezone: string;
  readonly communication: "brief" | "detailed" | "conversational";
  readonly constraints?: string;
  /** Telegram chat id for DM delivery. Used for cron delivery target + allowFrom. */
  readonly telegramChatId?: string;
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
  readonly personality: CanonicalPersonality;
}
