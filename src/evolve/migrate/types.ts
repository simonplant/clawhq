/**
 * Types for migration import from ChatGPT and Google Assistant exports.
 *
 * Migrating users export their data from big-tech assistants, and ClawHQ
 * parses it locally to extract preferences, routines, and patterns —
 * giving the forged agent a head start on day 1. All processing is local;
 * PII is masked before anything is stored.
 */

import type { CronJobDefinition } from "../../config/types.js";
import type { PiiMaskReport } from "../lifecycle/types.js";

// ── Source Platform ──────────────────────────────────────────────────────────

/** Supported migration source platforms. */
export type MigrationSource = "chatgpt" | "google-assistant";

// ── ChatGPT Export Structures ────────────────────────────────────────────────

/** A single ChatGPT conversation turn. */
export interface ChatGPTMessage {
  readonly author: { readonly role: string };
  readonly content: { readonly parts: readonly string[] };
  readonly create_time?: number;
}

/** A ChatGPT conversation node (tree structure). */
export interface ChatGPTNode {
  readonly id: string;
  readonly message?: ChatGPTMessage | null;
  readonly children: readonly string[];
}

/** Top-level ChatGPT conversation export. */
export interface ChatGPTConversation {
  readonly title: string;
  readonly create_time: number;
  readonly update_time: number;
  readonly mapping: Readonly<Record<string, ChatGPTNode>>;
}

// ── Google Assistant Export Structures ────────────────────────────────────────

/** A Google Assistant activity entry (from My Activity takeout). */
export interface GoogleAssistantActivity {
  readonly header: string;
  readonly title: string;
  readonly time: string;
  readonly products: readonly string[];
  readonly details?: readonly { readonly name: string }[];
}

/** A Google Assistant routine action. */
export interface GoogleAssistantRoutineAction {
  readonly type: string;
  readonly command?: string;
}

/** A Google Assistant routine definition. */
export interface GoogleAssistantRoutine {
  readonly name: string;
  readonly trigger: string;
  readonly actions: readonly GoogleAssistantRoutineAction[];
}

// ── Parsed Results ───────────────────────────────────────────────────────────

/** A parsed user message extracted from an export. */
export interface ParsedMessage {
  readonly text: string;
  readonly timestamp?: string;
  readonly source: MigrationSource;
}

/** Result from parsing a platform export. */
export interface ParseResult {
  readonly success: boolean;
  readonly source: MigrationSource;
  /** User messages extracted from the export. */
  readonly messages: readonly ParsedMessage[];
  /** Routines/recurring patterns found in the export. */
  readonly routines: readonly ParsedRoutine[];
  /** Number of conversations/activities processed. */
  readonly itemCount: number;
  readonly error?: string;
}

/** A recurring routine parsed from an export. */
export interface ParsedRoutine {
  readonly name: string;
  /** Natural-language description of when this runs. */
  readonly schedule: string;
  /** What the routine does. */
  readonly description: string;
  readonly source: MigrationSource;
}

// ── Preference Extraction ────────────────────────────────────────────────────

/** A preference extracted via local Ollama inference. */
export interface ExtractedPreference {
  /** Category: communication, scheduling, interests, etc. */
  readonly category: string;
  /** The preference itself. */
  readonly preference: string;
  /** Confidence: high, medium, low. */
  readonly confidence: "high" | "medium" | "low";
}

/** Result from preference extraction. */
export interface ExtractionResult {
  readonly success: boolean;
  readonly preferences: readonly ExtractedPreference[];
  /** Whether Ollama was available for extraction. */
  readonly ollamaUsed: boolean;
  readonly error?: string;
}

// ── Cron Mapping ─────────────────────────────────────────────────────────────

/** A routine mapped to a cron job definition. */
export interface MappedCronJob {
  /** The original routine that was mapped. */
  readonly routine: ParsedRoutine;
  /** The generated cron job. */
  readonly cronJob: CronJobDefinition;
}

/** Result from routine-to-cron mapping. */
export interface CronMappingResult {
  readonly success: boolean;
  readonly mappings: readonly MappedCronJob[];
  readonly unmapped: readonly ParsedRoutine[];
}

// ── Migration Pipeline ───────────────────────────────────────────────────────

/** Pipeline steps for migration progress reporting. */
export type MigrationStep =
  | "parse"
  | "extract"
  | "map-cron"
  | "mask-pii"
  | "write";

/** Status of a pipeline step. */
export type MigrationStepStatus = "running" | "done" | "failed" | "skipped";

/** Progress event for migration operations. */
export interface MigrationProgress {
  readonly step: MigrationStep;
  readonly status: MigrationStepStatus;
  readonly message: string;
}

/** Callback for step-by-step progress reporting. */
export type MigrationProgressCallback = (progress: MigrationProgress) => void;

/** Options for running a migration import. */
export interface MigrationOptions {
  /** Path to the export file or directory. */
  readonly exportPath: string;
  /** Source platform. */
  readonly source: MigrationSource;
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Ollama base URL (default: http://127.0.0.1:11434). */
  readonly ollamaUrl?: string;
  /** Ollama model for preference extraction. */
  readonly ollamaModel?: string;
  /** Progress callback. */
  readonly onProgress?: MigrationProgressCallback;
}

/** Final result of a complete migration import. */
export interface MigrationResult {
  readonly success: boolean;
  readonly source: MigrationSource;
  /** Number of conversations/activities parsed. */
  readonly itemsParsed: number;
  /** Preferences extracted. */
  readonly preferences: readonly ExtractedPreference[];
  /** Cron jobs generated from routines. */
  readonly cronJobs: readonly CronJobDefinition[];
  /** PII masking report. */
  readonly piiReport: PiiMaskReport;
  /** Routines that couldn't be mapped to cron. */
  readonly unmappedRoutines: readonly ParsedRoutine[];
  readonly error?: string;
}
