/**
 * Integration list formatting for terminal and JSON output.
 */

import type { IntegrationListResult } from "./types.js";

/**
 * Format integration list as a terminal table.
 */
export function formatIntegrationList(result: IntegrationListResult): string {
  if (result.total === 0) {
    return "No integrations configured.\n  Add one: clawhq integrate add <name>";
  }

  const lines: string[] = [];
  lines.push("Configured Integrations\n");

  const col1 = Math.max(12, ...result.integrations.map((i) => i.name.length)) + 2;
  const col2 = 12; // "✔ valid" / "✘ invalid"
  const col3 = 12; // role

  lines.push(pad("Name", col1) + pad("Status", col2) + pad("Role", col3) + "Keys");
  lines.push(pad("─".repeat(col1 - 2), col1) + pad("─".repeat(col2 - 2), col2) + pad("─".repeat(col3 - 2), col3) + "─".repeat(20));

  for (const i of result.integrations) {
    const status = i.validated ? "✔ valid" : "✘ unverified";
    const role = i.role ?? "—";
    const keys = i.envKeys.join(", ");
    lines.push(pad(i.name, col1) + pad(status, col2) + pad(role, col3) + keys);
  }

  lines.push(`\n${result.total} integration(s) configured`);
  return lines.join("\n");
}

/**
 * Format integration list as JSON.
 */
export function formatIntegrationListJson(result: IntegrationListResult): string {
  return JSON.stringify(result, null, 2);
}

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}
