/**
 * TOOLS.md generator — role-organized tool reference.
 *
 * TOOLS.md organizes the agent's tools by category with descriptions,
 * giving the LLM a structured reference for when and how to use each
 * tool. AGENTS.md lists capabilities; TOOLS.md explains usage by role.
 *
 * Identity files are read-only at runtime (LM-12 prevention).
 */

import type { Blueprint, ToolEntry } from "../blueprints/types.js";

/**
 * Generate TOOLS.md content from a blueprint's toolbelt.
 *
 * Produces a role-organized tool reference covering:
 * - Tools grouped by category
 * - Required vs optional indicators
 * - Descriptions for each tool
 * - Skills with their descriptions
 */
export function generateTools(blueprint: Blueprint): string {
  const { toolbelt } = blueprint;

  const sections: string[] = [
    `# Tool Reference: ${blueprint.name}`,
    "",
    `**Role:** ${toolbelt.role}`,
    "",
    toolbelt.description,
    "",
  ];

  // Group tools by category
  const byCategory = groupByCategory(toolbelt.tools);
  const categories = [...byCategory.keys()].sort();

  sections.push("## Tools by Category", "");

  for (const category of categories) {
    const tools = byCategory.get(category)!;
    sections.push(`### ${formatCategory(category)}`, "");

    for (const tool of tools) {
      const req = tool.required ? "**required**" : "optional";
      sections.push(`- **${tool.name}** (${req}) — ${tool.description}`);
    }

    sections.push("");
  }

  // Skills section
  if (toolbelt.skills.length > 0) {
    sections.push("## Skills", "");

    for (const skill of toolbelt.skills) {
      const req = skill.required ? "**required**" : "optional";
      sections.push(`- **${skill.name}** (${req}) — ${skill.description}`);
    }

    sections.push("");
  }

  return sections.join("\n");
}

/** Group tools by their category. */
function groupByCategory(tools: readonly ToolEntry[]): Map<string, ToolEntry[]> {
  const map = new Map<string, ToolEntry[]>();
  for (const tool of tools) {
    const group = map.get(tool.category) ?? [];
    group.push(tool);
    map.set(tool.category, group);
  }
  return map;
}

/** Format a category name for display (capitalize first letter). */
function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}
