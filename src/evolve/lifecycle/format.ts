/**
 * Output formatters for export and destroy results.
 *
 * Two modes: human-readable table and machine-readable JSON.
 */

import type { DestructionProof, DestroyResult, ExportResult } from "./types.js";

// ── Export Formatters ───────────────────────────────────────────────────────

/** Format an export result as a human-readable string. */
export function formatExportTable(result: ExportResult): string {
  if (!result.success) {
    return `✘ Export failed: ${result.error}`;
  }

  const lines = [
    "✔ Export complete",
    "",
    `  Bundle:    ${result.bundlePath}`,
    `  Files:     ${result.fileCount}`,
    `  Size:      ${formatBytes(result.bundleSize ?? 0)}`,
    `  PII masked: ${result.piiMasked ?? 0} instances`,
  ];

  return lines.join("\n");
}

/** Format an export result as JSON. */
export function formatExportJson(result: ExportResult): string {
  return JSON.stringify(result, null, 2);
}

// ── Destroy Formatters ──────────────────────────────────────────────────────

/** Format a destroy result as a human-readable string. */
export function formatDestroyTable(result: DestroyResult): string {
  if (!result.success) {
    return `✘ Destruction failed: ${result.error}`;
  }

  const proof = result.proof;
  if (!proof) return "✘ Destruction failed: no proof generated";
  const lines = [
    "✔ Agent destroyed",
    "",
    `  Files wiped:   ${proof.files.length}`,
    `  Total bytes:   ${formatBytes(proof.totalBytes)}`,
    `  Destroyed at:  ${proof.destroyedAt}`,
    `  Proof file:    ${result.proofPath}`,
    "",
    "  Cryptographic proof:",
    `    Witness hash: ${proof.witnessHash.slice(0, 32)}...`,
    `    HMAC:         ${proof.hmacSignature.slice(0, 32)}...`,
    "",
    "  To verify: clawhq verify-proof <proof-file>",
    "  Or independently: recompute SHA-256 witness hash from file manifest,",
    "  then verify HMAC-SHA256(witnessHash, hmacKey) === hmacSignature.",
  ];

  return lines.join("\n");
}

/** Format a destroy result as JSON. */
export function formatDestroyJson(result: DestroyResult): string {
  return JSON.stringify(result, null, 2);
}

/** Format a destruction proof verification result. */
export function formatVerifyResult(proof: DestructionProof, valid: boolean): string {
  if (valid) {
    return [
      "✔ Destruction proof is valid",
      "",
      `  Destroyed at:  ${proof.destroyedAt}`,
      `  Files:         ${proof.files.length}`,
      `  Total bytes:   ${formatBytes(proof.totalBytes)}`,
      `  Witness hash:  ${proof.witnessHash.slice(0, 32)}...`,
    ].join("\n");
  }

  return [
    "✘ Destruction proof is INVALID",
    "",
    "  The proof has been tampered with or is corrupt.",
    "  The witness hash or HMAC signature does not match.",
  ].join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
