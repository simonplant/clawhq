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
  /** Routing hint: tells the agent WHEN to use this tool vs siblings in the
   *  same category. Critical when multiple tools do overlapping things
   *  (email vs email-fastmail, quote vs tradier, tasks vs backlog). Rendered
   *  directly into TOOLS.md under the tool's entry. Optional — omit for
   *  tools whose purpose is obvious from the name alone. */
  readonly when_to_use?: string;
}

export interface ProfileDelegation {
  readonly action: string;
  readonly tier: "execute" | "propose" | "approve";
  readonly example: string;
}

/**
 * Per-agent declaration inside a multi-agent profile YAML.
 *
 * Mirrors the documented overridable surface from
 * https://docs.openclaw.ai/concepts/multi-agent. The compiler maps each
 * entry directly to an `agents.list[]` entry in `openclaw.json`, applying
 * defaults for omitted fields (workspace defaults to the agent's id).
 *
 * Profiles WITHOUT an `agents` field stay single-agent (compiler emits
 * `agents.defaults` only). Profiles WITH a non-empty `agents` array
 * additionally emit `agents.list[]`.
 */
export interface ProfileAgentEntry {
  /** Agent id — required, unique within the profile. Becomes the
   *  AgentEntry.id and (by default) the workspace subdir name. */
  readonly id: string;
  /** Marks this agent as the default routing target when no binding
   *  matches. At most one agent per profile may set this true. */
  readonly default?: boolean;
  /** Workspace path relative to the deployDir's workspace root. Omit to
   *  default to the agent's id (e.g. id="markets" → "markets"). */
  readonly workspace?: string;
  /** Display name for channels and the control UI. */
  readonly name?: string;
  /** Free-text role description rendered into the agent's IDENTITY.md
   *  + AGENTS.md so the model reads its role on every session boot.
   *  Differentiates multi-agent siblings that share the canonical voice
   *  but have distinct mandates (e.g., markets vs vision vs life-ops). */
  readonly description?: string;
  /** Model selector. String form ("provider/model") is treated as strict
   *  no-fallback per upstream model-failover semantics. Object form with
   *  fallbacks declares a per-agent fallback chain. Omit to inherit the
   *  global `agents.defaults.model`. */
  readonly model?: string | { readonly primary: string; readonly fallbacks?: readonly string[] };
  /** Per-agent tool allow/deny — overrides any global tool restrictions. */
  readonly tools?: {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
  };
  /** Per-agent skill allowlist. Skills not listed here are not loaded
   *  for this agent. */
  readonly skills?: readonly string[];
  /** Per-agent sandbox override. `scope: "agent"` produces one container
   *  per agent. */
  readonly sandbox?: {
    readonly mode?: "off" | "all";
    readonly scope?: "agent" | "shared";
    readonly docker?: { readonly setupCommand?: string };
  };
  /** Per-agent heartbeat schedule and delivery target. */
  readonly heartbeat?: {
    readonly every?: string;
    readonly target?: string;
    readonly to?: string;
    readonly model?: string;
  };
  /** Per-agent identity name shown in channels. */
  readonly identity?: {
    readonly name?: string;
  };
  /** Group-chat mention patterns that route to this agent. */
  readonly groupChat?: {
    readonly mentionPatterns?: readonly string[];
  };
}

export interface MissionProfile {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly replaces: string;
  /** Profile-specific elaboration of the canonical core_mandate — how the
   *  "interpret signals, produce actions and process" stance applies
   *  concretely to this profile's inputs. For life-ops that's email /
   *  calendar / tasks / messages → drafts / reschedules / extractions /
   *  journal entries. Rendered near the top of AGENTS.md so the agent
   *  reads the operating stance before the tool inventory. Optional —
   *  canonical.core_mandate is the foundation; profile elaboration is
   *  useful but not mandatory. */
  readonly operating_mandate?: string;
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
  /**
   * Multi-agent declaration. When present and non-empty, the compiler emits
   * `agents.list[]` in openclaw.json alongside `agents.defaults`. When
   * absent, the profile stays single-agent (every existing profile today).
   *
   * Per-agent overrides apply on top of `agents.defaults` at runtime —
   * see https://docs.openclaw.ai/concepts/multi-agent.
   */
  readonly agents?: readonly ProfileAgentEntry[];
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
  /** Foundation operating stance — applies to every ClawHQ agent,
   *  independent of profile. Answers "what's your job?" at the level
   *  above tools and workflows: interpret signals, produce actions and
   *  process. Rendered prominently in SOUL.md so the agent reads it
   *  on every session boot. */
  readonly core_mandate: string;
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
  /** Per-channel composition values. Widened to `unknown` (from the original
   *  string-only type) because channel YAML legitimately carries booleans
   *  (`enabled: true`), numbers (ports), and nested objects (streaming
   *  modes). The compiler at openclawJson.channels branches on value type
   *  and copies whatever it receives straight into openclaw.json. */
  readonly channels?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly soul_overrides?: string;
  readonly extra_tools?: readonly string[];
  /** Override the default model (provider-prefixed, e.g. "ollama/<tag>" or "anthropic/<model>"). */
  readonly model?: string;
  /** Override the model's contextWindow in openclaw.json (caps KV cache / VRAM). */
  readonly modelContextWindow?: number;
  /** Override fallback models (ollama-prefixed strings). */
  readonly modelFallbacks?: readonly string[];
  /** Extra egress domains merged into the allowlist for per-deploy needs
   *  (e.g. a specific Substack subdomain the profile doesn't know about). */
  readonly extra_egress_domains?: readonly string[];
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
