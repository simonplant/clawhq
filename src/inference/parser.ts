/**
 * Response parser for LLM inference output.
 *
 * Extracts structured InferenceResult from LLM text responses,
 * handling JSON extraction from potentially messy output.
 */

import type { TemplateChoice } from "../init/types.js";

import type { InferenceResult } from "./types.js";

const VALID_AUTONOMY = ["low", "medium", "high"] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIMEZONE_PATTERN = /^[A-Za-z]+\/[A-Za-z_]+$/;

/**
 * Parse the LLM response text into a structured InferenceResult.
 * Attempts to extract JSON from potentially wrapped output.
 */
export function parseInferenceResponse(
  text: string,
  templates: TemplateChoice[],
): InferenceResult | null {
  const json = extractJson(text);
  if (!json) return null;

  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return normalizeResult(raw, templates);
  } catch {
    return null;
  }
}

/**
 * Extract a JSON object from text that may contain markdown fences
 * or surrounding prose.
 */
function extractJson(text: string): string | null {
  // Try markdown code fence first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find a raw JSON object
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }

  return null;
}

/**
 * Normalize and validate raw parsed JSON into a proper InferenceResult.
 * Applies defaults and coerces values where possible.
 */
function normalizeResult(
  raw: Record<string, unknown>,
  templates: TemplateChoice[],
): InferenceResult {
  const templateIds = templates.map((t) => t.id);

  // Template ID — must match an available template
  let templateId = String(raw["templateId"] ?? "");
  if (!templateIds.includes(templateId)) {
    // Try fuzzy match by name
    const byName = templates.find(
      (t) => t.name.toLowerCase() === String(raw["templateId"] ?? "").toLowerCase(),
    );
    templateId = byName?.id ?? templateIds[0];
  }

  // Agent name
  const agentName = sanitizeAgentName(String(raw["agentName"] ?? "openclaw"));

  // Timezone
  let timezone = String(raw["timezone"] ?? "UTC");
  if (!TIMEZONE_PATTERN.test(timezone)) timezone = "UTC";

  // Waking hours
  let wakingHoursStart = String(raw["wakingHoursStart"] ?? "07:00");
  if (!TIME_PATTERN.test(wakingHoursStart)) wakingHoursStart = "07:00";

  let wakingHoursEnd = String(raw["wakingHoursEnd"] ?? "23:00");
  if (!TIME_PATTERN.test(wakingHoursEnd)) wakingHoursEnd = "23:00";

  // Integrations — always include messaging
  const rawIntegrations = Array.isArray(raw["integrations"])
    ? (raw["integrations"] as string[]).map(String)
    : ["messaging"];
  const integrations = rawIntegrations.includes("messaging")
    ? rawIntegrations
    : ["messaging", ...rawIntegrations];

  // Autonomy level
  const rawAutonomy = String(raw["autonomyLevel"] ?? "medium");
  const autonomyLevel = VALID_AUTONOMY.includes(rawAutonomy as typeof VALID_AUTONOMY[number])
    ? (rawAutonomy as "low" | "medium" | "high")
    : "medium";

  // Boundaries
  const boundaries = Array.isArray(raw["boundaries"])
    ? (raw["boundaries"] as string[]).map(String)
    : [];

  // Cloud providers
  const cloudProviders = Array.isArray(raw["cloudProviders"])
    ? (raw["cloudProviders"] as string[]).map(String)
    : [];

  // Cloud categories
  const cloudCategories = Array.isArray(raw["cloudCategories"])
    ? (raw["cloudCategories"] as string[]).map(String)
    : [];

  return {
    templateId,
    agentName,
    timezone,
    wakingHoursStart,
    wakingHoursEnd,
    integrations,
    autonomyLevel,
    boundaries,
    cloudProviders,
    cloudCategories,
  };
}

/** Sanitize agent name to be lowercase, no spaces, valid identifier. */
function sanitizeAgentName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "openclaw";
}

/**
 * Format an InferenceResult as a plain-language summary for user review.
 */
export function formatProposal(
  result: InferenceResult,
  templates: TemplateChoice[],
): string {
  const template = templates.find((t) => t.id === result.templateId);
  const templateName = template?.name ?? result.templateId;

  const lines: string[] = [];
  lines.push("Here's what I understood:");
  lines.push("");
  lines.push(`  Template:     ${templateName}`);
  lines.push(`  Agent name:   ${result.agentName}`);
  lines.push(`  Timezone:     ${result.timezone}`);
  lines.push(`  Waking hours: ${result.wakingHoursStart} - ${result.wakingHoursEnd}`);
  lines.push(`  Autonomy:     ${result.autonomyLevel}`);
  lines.push("");
  lines.push(`  Integrations: ${result.integrations.join(", ")}`);

  if (result.cloudProviders.length > 0) {
    lines.push(`  Cloud APIs:   ${result.cloudProviders.join(", ")}`);
    lines.push(`  Cloud tasks:  ${result.cloudCategories.join(", ")}`);
  } else {
    lines.push("  Cloud APIs:   none (local-only)");
  }

  if (result.boundaries.length > 0) {
    lines.push("");
    lines.push("  Boundaries:");
    for (const b of result.boundaries) {
      lines.push(`    - ${b}`);
    }
  }

  return lines.join("\n");
}
