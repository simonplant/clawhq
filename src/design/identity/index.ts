/**
 * Identity module — generates identity files from blueprints.
 *
 * Identity files define who the agent IS, what it CAN do, who it serves,
 * how to use its tools, and domain-specific operating procedures. They are
 * mounted read-only in the container (LM-12) and must fit within the
 * token budget (LM-08: bootstrapMaxChars, default 20,000).
 *
 * Generated files:
 * - SOUL.md — agent personality and boundaries
 * - AGENTS.md — capability inventory and autonomy model
 * - USER.md — user profile (name, timezone, preferences)
 * - TOOLS.md — role-organized tool reference by category
 * - Blueprint runbooks — domain-specific operating procedures
 */

import { BOOTSTRAP_MAX_CHARS } from "../../config/defaults.js";
import type { UserContext } from "../configure/types.js";
import type { Blueprint, PersonalityDimensions } from "../blueprints/types.js";

import { generateAgents } from "./agents.js";
import { generateSoul } from "./soul.js";
import { generateTools } from "./tools.js";
import { generateUser } from "./user.js";

export { generateAgents } from "./agents.js";
export { generateSoul } from "./soul.js";
export { generateTools } from "./tools.js";
export { generateUser } from "./user.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Identity file with content for writing and metadata for validation. */
export interface IdentityFileContent {
  readonly name: string;
  readonly relativePath: string;
  readonly content: string;
}

/** Default token budget for identity content (LM-08). */
const DEFAULT_MAX_CHARS = BOOTSTRAP_MAX_CHARS;

// ── Generator ───────────────────────────────────────────────────────────────

/**
 * Generate all identity files from a blueprint.
 *
 * Returns identity files (SOUL.md, AGENTS.md, USER.md, TOOLS.md, and
 * any blueprint-defined runbooks) with content that:
 * - Reflects the blueprint's personality, tools, and skills
 * - Includes user context (name, timezone, preferences)
 * - Organizes tools by category for role-based reference
 * - Includes domain-specific runbooks from the blueprint
 * - Fits within the token budget (LM-08)
 * - Is ready for read-only mount in the container (LM-12)
 */
export function generateIdentityFiles(
  blueprint: Blueprint,
  maxChars: number = DEFAULT_MAX_CHARS,
  customizationAnswers: Readonly<Record<string, string>> = {},
  personalityDimensions?: PersonalityDimensions,
  userContext?: UserContext,
): IdentityFileContent[] {
  const files: IdentityFileContent[] = [
    {
      name: "SOUL.md",
      relativePath: "workspace/identity/SOUL.md",
      content: generateSoul(blueprint, customizationAnswers, personalityDimensions),
    },
    {
      name: "AGENTS.md",
      relativePath: "workspace/identity/AGENTS.md",
      content: generateAgents(blueprint),
    },
    {
      name: "TOOLS.md",
      relativePath: "workspace/identity/TOOLS.md",
      content: generateTools(blueprint),
    },
  ];

  // Include USER.md if user context was collected
  if (userContext) {
    files.push({
      name: "USER.md",
      relativePath: "workspace/identity/USER.md",
      content: generateUser(userContext),
    });
  }

  // Include blueprint-defined runbooks
  if (blueprint.runbooks) {
    for (const runbook of blueprint.runbooks) {
      files.push({
        name: runbook.name,
        relativePath: `workspace/identity/${runbook.name}`,
        content: runbook.content,
      });
    }
  }

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
  while (end > 0 && (buf[end] & 0xc0) === 0x80) {
    end--;
  }

  return buf.subarray(0, end).toString("utf-8");
}
