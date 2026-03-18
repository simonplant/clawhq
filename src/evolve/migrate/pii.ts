/**
 * PII detection and masking for migration data.
 *
 * Scans extracted items for personally identifiable information and
 * masks it before writing to identity/memory files. Uses patterns
 * consistent with the project's security/secrets scanner and
 * internal/memory/transitions PII masking.
 */

import type { ExtractedItem } from "./types.js";

/** PII pattern with its replacement token. */
interface PIIPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/** PII patterns for detection and masking. */
const PII_PATTERNS: PIIPattern[] = [
  { name: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  {
    name: "Credit card",
    pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{3,4}\b/g,
    replacement: "[CARD]",
  },
  { name: "Email address", pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, replacement: "[EMAIL]" },
  { name: "Phone number", pattern: /\b(?:\+1[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/g, replacement: "[PHONE]" },
  { name: "Person name", pattern: /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, replacement: "[NAME]" },
];

/** Result of scanning a single item for PII. */
export interface PIIScanResult {
  hasPII: boolean;
  matches: { pattern: string; count: number }[];
  maskedContent: string;
}

/**
 * Scan text for PII and return detection results with masked version.
 */
export function scanForPII(text: string): PIIScanResult {
  const matches: { pattern: string; count: number }[] = [];
  let maskedContent = text;
  let hasPII = false;

  for (const { name, pattern, replacement } of PII_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    const found = text.match(pattern);
    if (found && found.length > 0) {
      hasPII = true;
      matches.push({ pattern: name, count: found.length });
      maskedContent = maskedContent.replace(pattern, replacement);
    }
  }

  return { hasPII, matches, maskedContent };
}

/**
 * Apply PII masking to extracted items.
 * Returns new items with PII masked and the piiMasked flag set.
 */
export function maskExtractedItems(items: ExtractedItem[]): {
  items: ExtractedItem[];
  totalPIIFound: number;
  itemsWithPII: number;
} {
  let totalPIIFound = 0;
  let itemsWithPII = 0;

  const masked = items.map((item) => {
    const scan = scanForPII(item.content);
    if (scan.hasPII) {
      itemsWithPII++;
      totalPIIFound += scan.matches.reduce((sum, m) => sum + m.count, 0);
      return {
        ...item,
        content: scan.maskedContent,
        piiMasked: true,
      };
    }
    return item;
  });

  return { items: masked, totalPIIFound, itemsWithPII };
}
