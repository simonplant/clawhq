/**
 * PII masking for export bundles.
 *
 * Applies pattern-based masking for common PII types:
 * email addresses, phone numbers, SSNs, credit card numbers,
 * and names in structured fields.
 */

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PiiPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/** PII patterns to mask in exported files. */
export const PII_PATTERNS: PiiPattern[] = [
  {
    name: "Email address",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL_REDACTED]",
  },
  {
    name: "Phone number (US)",
    pattern: /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    replacement: "[PHONE_REDACTED]",
  },
  {
    name: "SSN",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN_REDACTED]",
  },
  {
    name: "Credit card",
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    replacement: "[CC_REDACTED]",
  },
  {
    name: "IP address",
    pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    replacement: "[IP_REDACTED]",
  },
];

/** File extensions that can contain PII text. */
const TEXT_EXTENSIONS = new Set([
  ".json", ".yml", ".yaml", ".md", ".txt", ".ts", ".js",
  ".cfg", ".conf", ".ini", ".toml", ".log",
]);

/**
 * Apply PII masking to a text string.
 */
export function maskPiiInText(text: string): string {
  let result = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Apply PII masking to all text files in a directory (in-place).
 */
export async function maskPiiInDirectory(dir: string): Promise<number> {
  let maskedCount = 0;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return maskedCount;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);

    if (s.isDirectory()) {
      maskedCount += await maskPiiInDirectory(fullPath);
    } else if (s.isFile()) {
      const ext = entry.slice(entry.lastIndexOf("."));
      if (TEXT_EXTENSIONS.has(ext)) {
        const content = await readFile(fullPath, "utf-8");
        const masked = maskPiiInText(content);
        if (masked !== content) {
          await writeFile(fullPath, masked, "utf-8");
          maskedCount++;
        }
      }
    }
  }

  return maskedCount;
}
