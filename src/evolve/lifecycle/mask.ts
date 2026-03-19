/**
 * PII masking for export bundles.
 *
 * Detects and replaces personally identifiable information in text files
 * before they leave the machine. Patterns cover common PII categories:
 * emails, phone numbers, SSNs, credit cards, IP addresses, and API keys.
 *
 * Design: deterministic replacement — the same input always produces the
 * same masked output within a single export run, so structure is preserved
 * without leaking data.
 */

import type { PiiCategory, PiiMaskReport } from "./types.js";

// ── PII Patterns ────────────────────────────────────────────────────────────

interface PiiPattern {
  readonly category: PiiCategory;
  readonly pattern: RegExp;
  readonly replacement: string;
}

const PII_PATTERNS: readonly PiiPattern[] = [
  {
    category: "email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL REDACTED]",
  },
  {
    category: "phone",
    // US/international formats: +1-234-567-8901, (234) 567-8901, 234.567.8901
    pattern: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[PHONE REDACTED]",
  },
  {
    category: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN REDACTED]",
  },
  {
    category: "credit_card",
    // Visa, Mastercard, Amex, Discover — with optional separators
    pattern: /\b(?:\d{4}[-\s]?){3}\d{1,4}\b/g,
    replacement: "[CARD REDACTED]",
  },
  {
    category: "ip_address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[IP REDACTED]",
  },
  {
    category: "api_key",
    // Common API key patterns: sk-xxx, key-xxx, api_xxx, long hex/base64 strings
    pattern: /\b(?:sk-|key-|api[_-])[a-zA-Z0-9_-]{20,}\b/g,
    replacement: "[API_KEY REDACTED]",
  },
];

// ── File Extension Filter ───────────────────────────────────────────────────

/** Extensions of files that should be scanned for PII. Binary files are skipped. */
const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".jsonl", ".yaml", ".yml",
  ".toml", ".env", ".cfg", ".conf", ".ini", ".log",
  ".ts", ".js", ".py", ".sh", ".bash",
  ".html", ".htm", ".xml", ".csv",
]);

/** Check if a file path refers to a text file that should be PII-scanned. */
export function isTextFile(filePath: string): boolean {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return false;
  return TEXT_EXTENSIONS.has(filePath.slice(dotIndex).toLowerCase());
}

// ── Masking Engine ──────────────────────────────────────────────────────────

export interface MaskResult {
  readonly text: string;
  readonly maskedCount: number;
  readonly categories: Partial<Record<PiiCategory, number>>;
}

/** Mask all PII in the given text. Returns masked text and counts by category. */
export function maskPii(text: string): MaskResult {
  let result = text;
  const categories: Partial<Record<PiiCategory, number>> = {};
  let total = 0;

  for (const { category, pattern, replacement } of PII_PATTERNS) {
    // Reset lastIndex for each pattern (they use /g flag)
    const re = new RegExp(pattern.source, pattern.flags);
    const matches = result.match(re);
    if (matches && matches.length > 0) {
      categories[category] = (categories[category] ?? 0) + matches.length;
      total += matches.length;
      result = result.replace(re, replacement);
    }
  }

  return { text: result, maskedCount: total, categories };
}

/** Create an empty PII mask report. */
export function emptyMaskReport(): PiiMaskReport {
  return {
    totalMasked: 0,
    byCategory: { email: 0, phone: 0, ssn: 0, credit_card: 0, ip_address: 0, api_key: 0 },
    files: [],
  };
}

/** Merge mask results from a single file into the cumulative report. */
export function mergeMaskResult(
  report: PiiMaskReport,
  filePath: string,
  result: MaskResult,
): PiiMaskReport {
  if (result.maskedCount === 0) return report;

  const byCategory = { ...report.byCategory };
  for (const [cat, count] of Object.entries(result.categories) as [PiiCategory, number][]) {
    byCategory[cat] = (byCategory[cat] ?? 0) + count;
  }

  return {
    totalMasked: report.totalMasked + result.maskedCount,
    byCategory,
    files: [...report.files, filePath],
  };
}
