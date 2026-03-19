/**
 * AGENTS.md generator — the agent's tool and skill inventory.
 *
 * AGENTS.md reflects what the agent CAN do — its tools, skills, and
 * autonomy model. This file is consumed by the LLM at bootstrap to
 * understand its own capabilities and constraints.
 *
 * Identity files are read-only at runtime (LM-12 prevention).
 */

import type { Blueprint } from "../blueprints/types.js";

/**
 * Generate AGENTS.md content from a blueprint.
 *
 * Produces a capability inventory covering:
 * - Agent identity and role
 * - Tool inventory with categories and descriptions
 * - Skill inventory with descriptions
 * - Autonomy model (what requires approval)
 */
export function generateAgents(blueprint: Blueprint): string {
  const { toolbelt, autonomy_model: autonomy, use_case_mapping: useCase } = blueprint;

  const sections: string[] = [
    `# Agent: ${blueprint.name}`,
    "",
    `**Replaces:** ${useCase.replaces}`,
    `**Role:** ${toolbelt.role}`,
    "",
    "## Tools",
    "",
    ...formatTools(blueprint),
    "",
    "## Skills",
    "",
    ...formatSkills(blueprint),
    "",
    "## Autonomy",
    "",
    `**Default level:** ${autonomy.default}`,
    "",
    autonomy.requires_approval.length > 0
      ? "**Requires approval:**"
      : "**Requires approval:** none",
  ];

  if (autonomy.requires_approval.length > 0) {
    for (const item of autonomy.requires_approval) {
      sections.push(`- ${item}`);
    }
  }

  sections.push("");

  return sections.join("\n");
}

/** Format tool entries as markdown lines. */
function formatTools(blueprint: Blueprint): string[] {
  const lines: string[] = [];
  for (const tool of blueprint.toolbelt.tools) {
    const req = tool.required ? "required" : "optional";
    lines.push(`- **${tool.name}** [${tool.category}] _(${req})_ — ${tool.description}`);
  }
  return lines;
}

/** Format skill entries as markdown lines. */
function formatSkills(blueprint: Blueprint): string[] {
  const lines: string[] = [];
  for (const skill of blueprint.toolbelt.skills) {
    const req = skill.required ? "required" : "optional";
    lines.push(`- **${skill.name}** _(${req})_ — ${skill.description}`);
  }
  return lines;
}
