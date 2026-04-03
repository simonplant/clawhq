/**
 * Types for the init wizard, config generator, and atomic writer.
 *
 * WizardAnswers captures everything the wizard collects from the user.
 * GenerateOptions controls config generation behavior.
 * WriteResult reports what was written and where.
 */

import type { Blueprint, PersonalityDimensions } from "../blueprints/types.js";

// ── User Context ────────────────────────────────────────────────────────────

/** User context collected during setup — drives USER.md generation. */
export interface UserContext {
  /** User's display name (how the agent should address them). */
  readonly name: string;

  /** IANA timezone (e.g. "America/New_York"). */
  readonly timezone: string;

  /** Communication preference — how the user wants the agent to communicate. */
  readonly communicationPreference: "brief" | "detailed" | "conversational";

  /** Key constraints or notes the user wants the agent to know. */
  readonly constraints?: string;
}

// ── Wizard Types ─────────────────────────────────────────────────────────────

/** Collected answers from the interactive setup wizard. */
export interface WizardAnswers {
  /** Selected blueprint (loaded and validated). */
  readonly blueprint: Blueprint;

  /** Source path of the selected blueprint. */
  readonly blueprintPath: string;

  /** Messaging channel to use (from blueprint's supported list). */
  readonly channel: string;

  /** Model routing: local (Ollama) or cloud provider. */
  readonly modelProvider: "local" | "cloud";

  /** Preferred local model (e.g. "llama3:8b"). Only when modelProvider is local. */
  readonly localModel: string;

  /** Gateway port (default: GATEWAY_DEFAULT_PORT). */
  readonly gatewayPort: number;

  /** Deployment directory (default ~/.clawhq). */
  readonly deployDir: string;

  /** Instance name for multi-agent deployments. Defaults to 'default' for backward compatibility. */
  readonly instanceName?: string;

  /** Whether running in air-gapped mode (no internet). */
  readonly airGapped: boolean;

  /** Integration credentials keyed by integration name. */
  readonly integrations: Readonly<Record<string, Readonly<Record<string, string>>>>;

  /** Answers to blueprint customization questions, keyed by question ID. */
  readonly customizationAnswers: Readonly<Record<string, string>>;

  /** Personality dimensions selected during setup (optional — defaults from blueprint). */
  readonly personalityDimensions?: PersonalityDimensions;

  /** User context collected during setup — drives USER.md generation. */
  readonly userContext?: UserContext;

  /** Auth provider config (provider name + env vars for .env). */
  readonly auth?: {
    readonly provider?: string;
    readonly env?: Readonly<Record<string, string>>;
  };

  /** Channel-specific credentials (bot tokens, etc.). */
  readonly channelConfig?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Options for the interactive wizard. */
export interface WizardOptions {
  /** Pre-select a blueprint by name (skip blueprint selection step). */
  readonly blueprintName?: string;

  /** Override deploy directory. */
  readonly deployDir?: string;

  /** Force air-gapped mode. */
  readonly airGapped?: boolean;
}

// ── Generator Types ──────────────────────────────────────────────────────────

/** Options controlling config generation. */
export interface GenerateOptions {
  /** Wizard answers to generate from. */
  readonly answers: WizardAnswers;
}

// ── Writer Types ─────────────────────────────────────────────────────────────

/** A single file to be written atomically. */
export interface FileEntry {
  /** Relative path within the deploy directory (e.g. "engine/openclaw.json"). */
  readonly relativePath: string;

  /** File content as a string. */
  readonly content: string;

  /** File permission mode (e.g. 0o600 for secrets). Default: 0o644. */
  readonly mode?: number;
}

/** Result of writing files atomically. */
export interface WriteResult {
  /** Absolute paths of files successfully written. */
  readonly written: readonly string[];

  /** Deploy directory used. */
  readonly deployDir: string;
}
