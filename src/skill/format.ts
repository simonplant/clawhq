/**
 * Skill command output formatting.
 */

import type { InstalledSkill } from "./types.js";

/**
 * Format the skill list as a human-readable table.
 */
export function formatSkillList(skills: InstalledSkill[]): string {
  if (skills.length === 0) {
    return "No skills installed.\n\nInstall a skill with: clawhq skill install <name|path|url>";
  }

  const lines = ["Installed skills:", ""];

  // Table header
  lines.push(
    padRight("Name", 24)
    + padRight("Version", 12)
    + padRight("Source", 12)
    + padRight("Status", 10)
    + "Last Used",
  );
  lines.push("-".repeat(80));

  for (const skill of skills) {
    const lastUsed = skill.lastUsed
      ? new Date(skill.lastUsed).toLocaleDateString()
      : "never";

    lines.push(
      padRight(skill.name, 24)
      + padRight(skill.version, 12)
      + padRight(skill.source, 12)
      + padRight(skill.status, 10)
      + lastUsed,
    );
  }

  return lines.join("\n");
}

function padRight(str: string, width: number): string {
  return str.length >= width ? str + " " : str + " ".repeat(width - str.length);
}

/**
 * Format a skill install/update summary for the approval prompt.
 */
export function formatSkillSummary(
  name: string,
  version: string,
  description: string,
  files: string[],
  requiresContainerDeps: boolean,
): string {
  const lines = [
    `Skill: ${name} v${version}`,
  ];

  if (description) {
    lines.push(`Description: ${description}`);
  }

  lines.push(`Files: ${files.length}`);

  if (requiresContainerDeps) {
    lines.push("Container deps: YES — Stage 2 rebuild will be required");
  }

  return lines.join("\n");
}
