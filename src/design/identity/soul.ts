/**
 * SOUL.md generator — defines who the agent IS.
 *
 * SOUL.md is the agent's personality, communication style, and boundaries.
 * Without it, the user gets a generic instance, not a purpose-built agent.
 * Identity files are read-only at runtime (LM-12 prevention).
 *
 * Dual-path rendering:
 * - Dimensions present → prose sections from slider values + always-on boundaries
 * - Dimensions absent  → legacy rendering (flat strings, zero behavioral change)
 */

import { sanitizeContentSync } from "../../secure/sanitizer/index.js";
import { ALWAYS_ON_BOUNDARIES, renderAllDimensionsProse } from "../blueprints/personality-presets.js";
import type { Blueprint, PersonalityDimensions } from "../blueprints/types.js";

/**
 * Generate SOUL.md content from a blueprint.
 *
 * Produces a complete identity document covering:
 * - Who the agent is (name, role, tagline)
 * - Personality (tone/style or dimension prose)
 * - Boundaries (always-on security + blueprint-specific)
 * - A day in the life (narrative context)
 */
export function generateSoul(
  blueprint: Blueprint,
  customizationAnswers: Readonly<Record<string, string>> = {},
  dimensionOverrides?: PersonalityDimensions,
): string {
  const { personality } = blueprint;

  // Determine which dimensions to use (override > blueprint > none)
  const dimensions = dimensionOverrides ?? personality.dimensions;

  if (dimensions) {
    return generateDimensionSoul(blueprint, dimensions, customizationAnswers);
  }

  return generateLegacySoul(blueprint, customizationAnswers);
}

// ── Legacy Rendering (no dimensions) ─────────────────────────────────────────

function generateLegacySoul(
  blueprint: Blueprint,
  customizationAnswers: Readonly<Record<string, string>>,
): string {
  const { personality, use_case_mapping: useCase } = blueprint;

  const sections: string[] = [
    `# ${blueprint.name}`,
    "",
    `> ${useCase.tagline}`,
    "",
    "## Role",
    "",
    useCase.description.trim(),
    "",
    "## Personality",
    "",
    `- **Tone:** ${personality.tone}`,
    `- **Style:** ${personality.style}`,
    `- **Relationship:** ${personality.relationship}`,
    "",
    "## Boundaries",
    "",
    personality.boundaries,
  ];

  appendUserPreferences(sections, blueprint, customizationAnswers);
  appendDayInTheLife(sections, useCase.day_in_the_life);

  return sections.join("\n") + "\n";
}

// ── Dimension Rendering ──────────────────────────────────────────────────────

function generateDimensionSoul(
  blueprint: Blueprint,
  dimensions: PersonalityDimensions,
  customizationAnswers: Readonly<Record<string, string>>,
): string {
  const { personality, use_case_mapping: useCase } = blueprint;
  const prose = renderAllDimensionsProse(dimensions);

  const sections: string[] = [
    `# ${blueprint.name}`,
    "",
    `> ${useCase.tagline}`,
    "",
    "## Role",
    "",
    useCase.description.trim(),
    "",
    "## Personality",
    "",
    "### Communication Style",
    "",
    prose.communication,
    "",
    "### Working Style",
    "",
    prose.working,
    "",
    "### Cognitive Style",
    "",
    prose.cognitive,
    "",
    "## Relationship",
    "",
    `You are the user's ${personality.relationship}.`,
    "",
    "## Boundaries",
    "",
    "### Hard Boundaries (always enforced)",
    "",
    ...ALWAYS_ON_BOUNDARIES.map((b) => `- ${b}`),
    "",
    "### Operational Boundaries",
    "",
    personality.boundaries,
  ];

  appendUserPreferences(sections, blueprint, customizationAnswers);
  appendDayInTheLife(sections, useCase.day_in_the_life);

  return sections.join("\n") + "\n";
}

// ── Shared Helpers ───────────────────────────────────────────────────────────

function appendUserPreferences(
  sections: string[],
  blueprint: Blueprint,
  customizationAnswers: Readonly<Record<string, string>>,
): void {
  const answerEntries = Object.entries(customizationAnswers);
  if (answerEntries.length === 0) return;

  sections.push("", "## User Preferences", "");
  const questions = blueprint.customization_questions ?? [];
  for (const [id, answer] of answerEntries) {
    const question = questions.find((q) => q.id === id);
    const label = question ? question.prompt : id;
    // Sanitize user-provided customization answers
    const sanitized = sanitizeContentSync(answer, { source: "customization" });
    sections.push(`- **${label}** ${sanitized.text}`);
  }
}

function appendDayInTheLife(sections: string[], dayInTheLife: string): void {
  sections.push(
    "",
    "## A Day in the Life",
    "",
    dayInTheLife.trim(),
  );
}
