/**
 * SOUL.md generator — defines who the agent IS.
 *
 * SOUL.md is the agent's personality, communication style, and boundaries.
 * Every agent uses the single canonical ClawHQ personality vector
 * (CANONICAL_DIMENSIONS). Blueprints supply prose fields (tone, style,
 * relationship, boundaries) and a use-case narrative; the canonical
 * dimension vector is rendered into the Communication / Working /
 * Cognitive sections, and ALWAYS_ON_BOUNDARIES are injected verbatim.
 *
 * Identity files are read-only at runtime (LM-12 prevention).
 */

import { sanitizeContentSync } from "../../secure/sanitizer/index.js";
import {
  ALWAYS_ON_BOUNDARIES,
  CANONICAL_DIMENSIONS,
  renderAllDimensionsProse,
} from "../blueprints/personality-presets.js";
import type { Blueprint } from "../blueprints/types.js";

/**
 * Generate SOUL.md content from a blueprint.
 */
export function generateSoul(
  blueprint: Blueprint,
  customizationAnswers: Readonly<Record<string, string>> = {},
  soulOverrides?: string,
): string {
  const { personality, use_case_mapping: useCase } = blueprint;
  const prose = renderAllDimensionsProse(CANONICAL_DIMENSIONS);

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
  appendSoulOverrides(sections, soulOverrides);

  return sections.join("\n") + "\n";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function appendSoulOverrides(sections: string[], soulOverrides?: string): void {
  const trimmed = soulOverrides?.trim();
  if (!trimmed) return;
  sections.push("", "## Additional Notes", "", trimmed);
}
