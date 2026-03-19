/**
 * SOUL.md generator — defines who the agent IS.
 *
 * SOUL.md is the agent's personality, communication style, and boundaries.
 * Without it, the user gets a generic instance, not a purpose-built agent.
 * Identity files are read-only at runtime (LM-12 prevention).
 */

import type { Blueprint } from "../blueprints/types.js";

/**
 * Generate SOUL.md content from a blueprint.
 *
 * Produces a complete identity document covering:
 * - Who the agent is (name, role, tagline)
 * - Personality (tone, style, relationship)
 * - Boundaries (what the agent will and won't do)
 * - A day in the life (narrative context)
 */
export function generateSoul(blueprint: Blueprint): string {
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
    "",
    "## A Day in the Life",
    "",
    useCase.day_in_the_life.trim(),
  ];

  return sections.join("\n") + "\n";
}
