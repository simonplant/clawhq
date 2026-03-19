/**
 * Identity module — generates SOUL.md and AGENTS.md from blueprints.
 *
 * Identity files define who the agent IS and what it CAN do. They are
 * mounted read-only in the container (LM-12) and must fit within the
 * token budget (LM-08: bootstrapMaxChars, default 20,000).
 */

import type { Blueprint } from "../blueprints/types.js";

import { generateAgents } from "./agents.js";
import { generateSoul } from "./soul.js";

export { generateAgents } from "./agents.js";
export { generateSoul } from "./soul.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Identity file with content for writing and metadata for validation. */
export interface IdentityFileContent {
  readonly name: string;
  readonly relativePath: string;
  readonly content: string;
}

/** Default token budget for identity content (LM-08). */
const DEFAULT_MAX_CHARS = 20_000;

// ── Generator ───────────────────────────────────────────────────────────────

/**
 * Generate all identity files from a blueprint.
 *
 * Returns SOUL.md and AGENTS.md with content that:
 * - Reflects the blueprint's personality, tools, and skills
 * - Fits within the token budget (LM-08)
 * - Is ready for read-only mount in the container (LM-12)
 */
export function generateIdentityFiles(
  blueprint: Blueprint,
  maxChars: number = DEFAULT_MAX_CHARS,
): IdentityFileContent[] {
  const files: IdentityFileContent[] = [
    {
      name: "SOUL.md",
      relativePath: "workspace/identity/SOUL.md",
      content: generateSoul(blueprint),
    },
    {
      name: "AGENTS.md",
      relativePath: "workspace/identity/AGENTS.md",
      content: generateAgents(blueprint),
    },
  ];

  // LM-08: Enforce token budget — truncate if content exceeds limit
  const totalSize = files.reduce(
    (sum, f) => sum + Buffer.byteLength(f.content, "utf-8"),
    0,
  );

  if (totalSize > maxChars) {
    return truncateToFit(files, maxChars);
  }

  return files;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Truncate identity files to fit within the token budget.
 *
 * Strategy: keep smaller files intact, truncate the largest. Appends
 * a truncation marker so the agent knows content was cut.
 */
function truncateToFit(
  files: IdentityFileContent[],
  maxChars: number,
): IdentityFileContent[] {
  const TRUNCATION_MARKER = "\n\n<!-- Identity content truncated to fit token budget -->\n";
  const markerSize = Buffer.byteLength(TRUNCATION_MARKER, "utf-8");

  // Sort by size ascending — keep smaller files intact, truncate largest last
  const sorted = [...files].sort(
    (a, b) =>
      Buffer.byteLength(a.content, "utf-8") -
      Buffer.byteLength(b.content, "utf-8"),
  );

  const result: IdentityFileContent[] = [];
  let remaining = maxChars;

  for (const file of sorted) {
    if (remaining <= 0) break;

    const size = Buffer.byteLength(file.content, "utf-8");

    if (size <= remaining) {
      result.push(file);
      remaining -= size;
    } else {
      // Truncate this file to fit
      const allowedBytes = Math.max(0, remaining - markerSize);
      if (allowedBytes <= 0) break;
      const truncated = truncateUtf8(file.content, allowedBytes) + TRUNCATION_MARKER;
      result.push({ ...file, content: truncated });
      remaining = 0;
    }
  }

  return result;
}

/** Truncate a UTF-8 string to at most `maxBytes` bytes without splitting characters. */
function truncateUtf8(str: string, maxBytes: number): string {
  const buf = Buffer.from(str, "utf-8");
  if (buf.length <= maxBytes) return str;

  // Walk backwards to find a safe cut point (don't split multi-byte chars)
  let end = maxBytes;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) {
    end--;
  }

  return buf.subarray(0, end).toString("utf-8");
}
