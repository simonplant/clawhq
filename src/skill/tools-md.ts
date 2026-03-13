/**
 * TOOLS.md skill section management.
 *
 * Reads and updates the Skills section of TOOLS.md when skills are
 * installed or removed, without touching other sections.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { InstalledSkill, SkillContext } from "./types.js";

const SKILLS_SECTION_HEADER = "## Skills";
const SKILLS_SECTION_MARKER = /^## Skills\s*$/m;

/**
 * Update the Skills section in TOOLS.md based on installed skills.
 */
export async function updateToolsMdSkills(
  ctx: SkillContext,
  skills: InstalledSkill[],
): Promise<void> {
  const toolsMdPath = join(ctx.openclawHome, "workspace", "TOOLS.md");

  let content: string;
  try {
    content = await readFile(toolsMdPath, "utf-8");
  } catch {
    // TOOLS.md doesn't exist yet — create minimal version
    content = "# TOOLS.md — Agent Toolbelt\n\n";
  }

  const activeSkills = skills.filter((s) => s.status === "active");
  const newSection = buildSkillsSection(activeSkills);

  const updated = replaceOrAppendSection(content, newSection);
  await writeFile(toolsMdPath, updated, "utf-8");
}

function buildSkillsSection(skills: InstalledSkill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const lines = [
    "---",
    "",
    SKILLS_SECTION_HEADER,
    "",
  ];

  for (const skill of skills) {
    lines.push(`- **${skill.name}** (v${skill.version}) — ${skill.source}: ${skill.sourceUri}`);
  }

  lines.push("");
  return lines.join("\n");
}

function replaceOrAppendSection(content: string, newSection: string): string {
  const match = SKILLS_SECTION_MARKER.exec(content);

  if (match) {
    // Find the start of the section (including preceding ---)
    const beforeSection = content.substring(0, match.index);

    // Find the next section header after Skills
    const afterMatch = content.substring(match.index + match[0].length);
    const nextSectionMatch = /^---\s*$\n^##\s/m.exec(afterMatch);

    // Look for a standalone --- that precedes the ## Skills header
    const trimmedBefore = beforeSection.replace(/---\s*\n\s*$/, "");

    if (nextSectionMatch) {
      const afterSection = afterMatch.substring(nextSectionMatch.index);
      return trimmedBefore + newSection + afterSection;
    }

    // Skills section is at the end
    return trimmedBefore + newSection;
  }

  // No existing Skills section — append before System Binaries or at the end
  const systemBinariesMatch = /^---\s*\n\s*^## System Binaries/m.exec(content);
  if (systemBinariesMatch) {
    const before = content.substring(0, systemBinariesMatch.index);
    const after = content.substring(systemBinariesMatch.index);
    return before + newSection + after;
  }

  // Append at end
  return content.trimEnd() + "\n\n" + newSection;
}
