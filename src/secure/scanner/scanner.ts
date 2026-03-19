/**
 * Core scanner — scans file content for secrets and PII.
 *
 * Matches content against known patterns, filters false positives,
 * and returns redacted findings. Never exposes raw secret values.
 */

import { SECRET_PATTERNS, isFalsePositive } from "./patterns.js";
import type { Finding } from "./types.js";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Scan file content for secrets and PII.
 *
 * Returns findings with redacted values. Never includes raw secrets.
 */
export function scanContent(
  content: string,
  filePath: string,
  source: "file" | "git" = "file",
  commit?: string,
): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  for (const sp of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Reset regex lastIndex for each line
      const re = new RegExp(sp.pattern.source, sp.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = re.exec(line)) !== null) {
        // Use captured group if present, otherwise full match
        const matchedValue = match[1] ?? match[0];

        if (isFalsePositive(sp.id, matchedValue, line)) continue;

        findings.push({
          category: sp.category,
          severity: sp.severity,
          description: sp.description,
          file: filePath,
          line: i + 1,
          redacted: redact(matchedValue),
          source,
          commit,
        });

        // One match per pattern per line to avoid duplicates
        break;
      }
    }
  }

  return dedup(findings);
}

// ── Redaction ───────────────────────────────────────────────────────────────

/**
 * Redact a secret value, showing only prefix and suffix.
 *
 * Examples:
 *   "sk-proj-abc123xyz789" → "sk-proj-****z789"
 *   "password123"          → "pass****d123"
 *   "short"                → "****"
 */
export function redact(value: string): string {
  if (value.length <= 8) return "****";

  // For values with a known prefix pattern (sk-, ghp_, etc.), keep the prefix
  const prefixMatch = value.match(/^([a-z]{2,4}[-_](?:[a-z]+-)?)/i);
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    const suffix = value.slice(-4);
    return `${prefix}****${suffix}`;
  }

  // Default: show first 4 and last 4
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

// ── Deduplication ───────────────────────────────────────────────────────────

/** Remove duplicate findings (same file, line, category). */
function dedup(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.category}:${f.redacted}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
