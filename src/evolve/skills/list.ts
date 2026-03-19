/**
 * List installed skills with their lifecycle status.
 *
 * Reads the skill manifest and formats for CLI display.
 */

import { loadManifest } from "./lifecycle.js";
import type { SkillListOptions, SkillManifestEntry } from "./types.js";

// ── List ─────────────────────────────────────────────────────────────────────

export interface SkillListResult {
  readonly skills: readonly SkillManifestEntry[];
  readonly total: number;
  readonly active: number;
}

/**
 * List all installed skills with their status.
 */
export async function listSkills(
  options: SkillListOptions,
): Promise<SkillListResult> {
  const manifest = await loadManifest(options.deployDir);
  const active = manifest.skills.filter((s) => s.status === "active").length;

  return {
    skills: manifest.skills,
    total: manifest.skills.length,
    active,
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format skill list for terminal display.
 */
export function formatSkillList(result: SkillListResult): string {
  if (result.total === 0) {
    return "No skills installed. Use 'clawhq skill install <source>' to add one.";
  }

  const lines: string[] = [];
  lines.push(`Installed skills: ${result.total} (${result.active} active)\n`);
  lines.push(padRight("NAME", 25) + padRight("STATUS", 15) + padRight("SOURCE", 30) + "INSTALLED");
  lines.push("─".repeat(80));

  for (const skill of result.skills) {
    const name = padRight(skill.name, 25);
    const status = padRight(skill.status, 15);
    const source = padRight(truncate(skill.source, 28), 30);
    const date = skill.stagedAt
      ? new Date(skill.stagedAt).toLocaleDateString()
      : "—";
    lines.push(`${name}${status}${source}${date}`);
  }

  return lines.join("\n");
}

/**
 * Format skill list as JSON for programmatic consumption.
 */
export function formatSkillListJson(result: SkillListResult): string {
  return JSON.stringify(
    {
      total: result.total,
      active: result.active,
      skills: result.skills,
    },
    null,
    2,
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen - 1) + "…";
}

