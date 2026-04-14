/**
 * Binary manifest for SHA256-pinned tool downloads.
 *
 * Every binary downloaded during Docker build is listed here with a
 * pinned SHA256 hash. The build fails immediately if any hash does
 * not match, preventing supply-chain attacks via compromised CDNs
 * or GitHub releases.
 *
 * To update hashes: `clawhq build --verify-hashes`
 */

import type { BinaryInstall } from "./types.js";

// ── SHA256 Validation ──────────────────────────────────────────────────────

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Throws if sha256 is not a valid lowercase hex SHA256 hash (64 chars). */
export function validateBinarySha256(sha256: string): void {
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(
      `Invalid SHA256 hash: "${sha256}". Expected 64 lowercase hex characters.`,
    );
  }
}

// ── Pinned Binary Manifest ─────────────────────────────────────────────────

/**
 * Pinned binary manifest — the auditable source of truth for all tool
 * binaries downloaded during Docker build.
 *
 * Each entry specifies the tool name, download URL, install path, and
 * SHA256 hash of the expected file.
 *
 * Hash sources: download the binary, run `sha256sum <file>`, paste the hash.
 *
 * Currently empty — binaries are populated per-blueprint during
 * `clawhq init`. When blueprints add binaries (himalaya, gh, etc.),
 * they must include pinned SHA256 hashes.
 */
export const PINNED_BINARIES: readonly BinaryInstall[] = [];

// ── 1Password CLI ──────────────���──────────────────────────────────────────

/**
 * 1Password CLI (op) install metadata.
 *
 * Used when a blueprint enables 1Password vault integration. The op CLI
 * is installed in Stage 2 so agents can fetch credentials at runtime
 * via `op read`.
 *
 * The op CLI is distributed as a zip archive, so it requires a custom
 * install RUN directive (not the standard binary download pattern).
 */
export const OP_CLI_VERSION = "2.30.3";
export const OP_CLI_URL = `https://cache.agilebits.com/dist/1P/op2/pkg/v${OP_CLI_VERSION}/op_linux_amd64_v${OP_CLI_VERSION}.zip`;
export const OP_CLI_SHA256 = "3c2daeb5e4547e6e72965a101e8a40bc425e61a3c498e9e9f17467e3ea1eceb2";
export const OP_CLI_DEST = "/usr/local/bin/op";

/**
 * Stage 1 apt packages required for 1Password CLI installation.
 * unzip is needed to extract the op CLI archive.
 */
export const OP_CLI_APT_DEPS: readonly string[] = ["unzip", "curl"] as const;

// ── Verification Reporting ─────────────────────────────────────────────────

export interface BinaryVerificationResult {
  readonly name: string;
  readonly expected: string;
  readonly actual: string;
  readonly ok: boolean;
}

export interface VerificationReport {
  readonly results: readonly BinaryVerificationResult[];
  readonly allPassed: boolean;
}

/** Format a verification failure as a clear, actionable error message. */
export function formatHashMismatch(result: BinaryVerificationResult): string {
  return [
    `SHA256 mismatch for ${result.name}:`,
    `  expected: ${result.expected}`,
    `  actual:   ${result.actual}`,
  ].join("\n");
}
