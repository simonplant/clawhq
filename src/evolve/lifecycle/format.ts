/**
 * Output formatters for export and destroy results.
 *
 * Two modes: human-readable table and machine-readable JSON.
 */

import type { DestroyResult, ExportResult } from "./types.js";

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

  const receipt = result.receipt;
  if (!receipt) return "✘ Destruction failed: no receipt generated";
  const lines = [
    "✔ Agent destroyed",
    "",
    `  Files wiped:   ${receipt.files.length}`,
    `  Total bytes:   ${formatBytes(receipt.totalBytes)}`,
    `  Destroyed at:  ${receipt.destroyedAt}`,
    `  Receipt file:  ${result.receiptPath}`,
  ];

  return lines.join("\n");
}

/** Format a destroy result as JSON. */
export function formatDestroyJson(result: DestroyResult): string {
  return JSON.stringify(result, null, 2);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** i;
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
