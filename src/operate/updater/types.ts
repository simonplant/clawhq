/**
 * Safe upstream update type definitions.
 *
 * Covers version checking, changelog display, update orchestration,
 * and rollback on failure.
 */

import type { StepResult } from "../../build/launcher/types.js";

// --- Version check ---

export interface ReleaseInfo {
  /** Release tag name (e.g., "v1.2.3"). */
  tag: string;
  /** Semver version extracted from tag. */
  version: string;
  /** Release publication date (ISO 8601). */
  publishedAt: string;
  /** Release page URL. */
  url: string;
}

export interface VersionCheckResult {
  /** Currently installed version tag (from image label or last build). */
  current: string;
  /** Latest available release. */
  latest: ReleaseInfo;
  /** Whether an update is available. */
  updateAvailable: boolean;
}

// --- Changelog ---

export interface ChangelogEntry {
  /** Release tag. */
  tag: string;
  /** Release version (semver). */
  version: string;
  /** Release date (ISO 8601). */
  date: string;
  /** Markdown body of the release notes. */
  body: string;
  /** Whether this release contains breaking changes. */
  breaking: boolean;
}

export interface ChangelogResult {
  /** Entries between current and latest (newest first). */
  entries: ChangelogEntry[];
  /** Whether any entry has breaking changes. */
  hasBreaking: boolean;
}

// --- Update orchestration ---

export interface UpdateOptions {
  /** OpenClaw home directory (default: ~/.openclaw). */
  openclawHome?: string;
  /** Path to docker-compose.yml. */
  composePath?: string;
  /** Path to .env file. */
  envPath?: string;
  /** OpenClaw source directory for rebuild. */
  context?: string;
  /** Dockerfile path (relative to context). */
  dockerfile?: string;
  /** Stage 1 base image tag. */
  baseTag?: string;
  /** Stage 2 final image tag. */
  finalTag?: string;
  /** Build manifest directory. */
  manifestDir?: string;
  /** GPG recipient for pre-update snapshot. */
  gpgRecipient?: string;
  /** Backup storage directory. */
  backupDir?: string;
  /** Health poll timeout in ms (default: 60000). */
  healthTimeoutMs?: number;
  /** Gateway host (default: 127.0.0.1). */
  gatewayHost?: string;
  /** Gateway port (default: 18789). */
  gatewayPort?: number;
  /** Cloud API providers for firewall allowlist. */
  enabledProviders?: string[];
  /** Docker bridge interface for firewall. */
  bridgeInterface?: string;
  /** Skip confirmation prompt (--force). */
  force?: boolean;
  /** Dry run — check only, don't apply (--check). */
  checkOnly?: boolean;
  /** GitHub owner/repo for release checks (default: "openclaw/openclaw"). */
  repo?: string;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export interface UpdateResult {
  /** Whether the full update sequence succeeded. */
  success: boolean;
  /** Step-by-step results. */
  steps: StepResult[];
  /** Version we updated from (or current version in check mode). */
  previousVersion: string;
  /** Version we updated to (or latest available in check mode). */
  newVersion: string;
  /** Whether a rollback was performed. */
  rolledBack: boolean;
  /** Backup ID created before updating (for manual recovery). */
  snapshotId?: string;
}

// --- Rollback ---

export interface RollbackOptions {
  /** Docker image tag to restore to. */
  previousImageTag: string;
  /** Path to docker-compose.yml. */
  composePath?: string;
  /** Health poll timeout in ms. */
  healthTimeoutMs?: number;
  /** Gateway host. */
  gatewayHost?: string;
  /** Gateway port. */
  gatewayPort?: number;
  /** Cloud API providers for firewall. */
  enabledProviders?: string[];
  /** Docker bridge interface for firewall. */
  bridgeInterface?: string;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export interface RollbackResult {
  /** Whether rollback succeeded. */
  success: boolean;
  /** Step-by-step results. */
  steps: StepResult[];
}

// --- Errors ---

export class UpdateError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "UpdateError";
  }
}
