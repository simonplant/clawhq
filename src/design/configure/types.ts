/**
 * Types for the init wizard, config generator, and atomic writer.
 *
 * WizardAnswers captures everything the wizard collects from the user.
 * GenerateOptions controls config generation behavior.
 * WriteResult reports what was written and where.
 */

import type { Blueprint } from "../blueprints/types.js";

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

  /** Gateway port (default 18789). */
  readonly gatewayPort: number;

  /** Deployment directory (default ~/.clawhq). */
  readonly deployDir: string;

  /** Whether running in air-gapped mode (no internet). */
  readonly airGapped: boolean;

  /** Integration credentials keyed by integration name. */
  readonly integrations: Readonly<Record<string, Readonly<Record<string, string>>>>;
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
