/**
 * Formatting for catalog search results and skill info display.
 */

import type { BuiltinSkillEntry } from "./catalog.js";

/**
 * Format search results as a human-readable table.
 */
export function formatCatalogSearch(skills: BuiltinSkillEntry[], query: string): string {
  if (skills.length === 0) {
    return `No skills found matching "${query}".`;
  }

  const lines = [
    `Found ${skills.length} skill${skills.length === 1 ? "" : "s"} matching "${query}":`,
    "",
    padRight("Name", 22) + padRight("Version", 10) + "Description",
    "-".repeat(80),
  ];

  for (const skill of skills) {
    const desc =
      skill.description.length > 46
        ? skill.description.substring(0, 43) + "..."
        : skill.description;
    lines.push(padRight(skill.id, 22) + padRight(skill.version, 10) + desc);
  }

  lines.push("");
  lines.push("Use `clawhq skill info <name>` for details, or `clawhq skill install <name>` to install.");

  return lines.join("\n");
}

/**
 * Format a single skill's full details for `skill info`.
 */
export function formatCatalogInfo(skill: BuiltinSkillEntry): string {
  const lines = [
    `${skill.name} (${skill.id}) v${skill.version}`,
    "",
    `  ${skill.description}`,
    "",
    `  Tags:          ${skill.tags.join(", ")}`,
    `  Integrations:  ${skill.requiredIntegrations.length > 0 ? skill.requiredIntegrations.join(", ") : "none (standalone)"}`,
    `  Cron schedule: ${skill.cronSchedule ?? "none (on-demand)"}`,
    `  Files:         ${Object.keys(skill.files).join(", ")}`,
    "",
    "Install with: clawhq skill install " + skill.id,
  ];

  return lines.join("\n");
}

function padRight(str: string, width: number): string {
  return str.length >= width ? str + " " : str + " ".repeat(width - str.length);
}
