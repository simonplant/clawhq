/**
 * PII + secrets scanner module.
 *
 * Surfaces API keys, passwords, tokens, and PII in workspace files before
 * deploy. False positives filtered to keep scan results trustworthy.
 */

// Orchestrator
export { runScan } from "./scan.js";

// Core scanner
export { redact, scanContent } from "./scanner.js";

// Directory walk
export { walkAndScan } from "./walk.js";
export type { WalkResult } from "./walk.js";

// Git history
export { scanGitHistory } from "./git.js";
export type { GitScanResult } from "./git.js";

// Formatters
export { formatScanJson, formatScanTable } from "./format.js";

// Patterns (for testing / extension)
export { isFalsePositive, shouldSkipFile } from "./patterns.js";
export type { SecretPattern } from "./patterns.js";

// Types
export type {
  Finding,
  FindingCategory,
  FindingSeverity,
  ScanOptions,
  ScanReport,
} from "./types.js";
