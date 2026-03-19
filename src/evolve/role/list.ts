/**
 * Role list formatting for terminal and JSON output.
 */

import type { RoleListResult } from "./types.js";

/**
 * Format role list as a terminal table.
 */
export function formatRoleList(result: RoleListResult): string {
  if (result.total === 0) {
    return "No roles defined.";
  }

  const lines: string[] = [];
  lines.push("Roles\n");

  const col1 = Math.max(10, ...result.roles.map((r) => r.name.length)) + 2;
  const col2 = 8;
  const col3 = Math.max(12, ...result.roles.map((r) => r.description.length)) + 2;

  lines.push(pad("Name", col1) + pad("Type", col2) + pad("Description", col3) + "Permissions");
  lines.push(
    pad("─".repeat(col1 - 2), col1) +
    pad("─".repeat(col2 - 2), col2) +
    pad("─".repeat(Math.min(col3 - 2, 30)), col3) +
    "─".repeat(20),
  );

  for (const r of result.roles) {
    const type = r.builtin ? "built-in" : "custom";
    const perms = r.permissions.join(", ");
    lines.push(pad(r.name, col1) + pad(type, col2) + pad(r.description, col3) + perms);
  }

  // Show assignments
  const assignmentEntries = Object.entries(result.assignments);
  if (assignmentEntries.length > 0) {
    lines.push("\nAssignments\n");
    for (const [integration, role] of assignmentEntries) {
      lines.push(`  ${integration} → ${role}`);
    }
  }

  lines.push(`\n${result.total} role(s) defined`);
  return lines.join("\n");
}

/**
 * Format role list as JSON.
 */
export function formatRoleListJson(result: RoleListResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format a role check result for terminal output.
 */
export function formatRoleCheck(integrationName: string, roleName: string | null, permissions: readonly string[]): string {
  if (!roleName) {
    return `Integration "${integrationName}" has no role assigned.\n  Assign one: clawhq role assign <role> ${integrationName}`;
  }

  const lines: string[] = [];
  lines.push(`Integration: ${integrationName}`);
  lines.push(`Role:        ${roleName}`);
  lines.push(`Permissions: ${permissions.join(", ")}`);
  return lines.join("\n");
}

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}
