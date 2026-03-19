/**
 * Types for tool installation framework.
 *
 * Tools are the agent's hands — CLI wrappers that let it interact with
 * external services. Unlike skills (which need vetting), tools are
 * generated from a known registry and trusted by default.
 *
 * Lifecycle: install → write to workspace/tools/ → update manifest → rebuild Stage 2.
 */

// ── Tool Manifest ───────────────────────────────────────────────────────────

/** Metadata for an installed tool. */
export interface ToolManifestEntry {
  /** Tool name (file name under workspace/tools/). */
  readonly name: string;
  /** Where the tool came from — "registry" for built-in, path for custom. */
  readonly source: string;
  /** ISO 8601 timestamp of installation. */
  readonly installedAt: string;
}

/** Full tool manifest file. */
export interface ToolManifest {
  readonly version: 1;
  readonly tools: ToolManifestEntry[];
}

// ── Install / Remove Options ────────────────────────────────────────────────

/** Options for tool installation. */
export interface ToolInstallOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Tool name to install (must exist in tool registry). */
  readonly name: string;
  /** Skip the Stage 2 rebuild after install. */
  readonly skipRebuild?: boolean;
}

/** Result of a tool installation. */
export interface ToolInstallResult {
  readonly success: boolean;
  readonly toolName: string;
  readonly rebuilt: boolean;
  readonly error?: string;
}

/** Options for tool removal. */
export interface ToolRemoveOptions {
  /** Path to the deployment directory (default: ~/.clawhq). */
  readonly deployDir: string;
  /** Tool name to remove. */
  readonly name: string;
  /** Skip the Stage 2 rebuild after removal. */
  readonly skipRebuild?: boolean;
}

/** Result of a tool removal. */
export interface ToolRemoveResult {
  readonly success: boolean;
  readonly toolName: string;
  readonly rebuilt: boolean;
  readonly error?: string;
}

/** Options for listing installed tools. */
export interface ToolListOptions {
  readonly deployDir: string;
}

/** Result of listing installed tools. */
export interface ToolListResult {
  readonly tools: readonly ToolManifestEntry[];
  readonly total: number;
}
