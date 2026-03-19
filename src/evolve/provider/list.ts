/**
 * Provider list formatting for terminal and JSON output.
 */

import type { ProviderListResult } from "./types.js";

/**
 * Format provider list as a terminal table.
 */
export function formatProviderList(result: ProviderListResult): string {
  if (result.total === 0) {
    return "No providers configured.\n  Add one: clawhq provider add <name>";
  }

  const lines: string[] = [];
  lines.push("Configured Providers\n");

  const col1 = Math.max(10, ...result.providers.map((p) => p.name.length)) + 2;
  const col2 = 12;
  const col3 = 16;

  lines.push(pad("Name", col1) + pad("Status", col2) + pad("Model", col3) + "Routes");
  lines.push(pad("─".repeat(col1 - 2), col1) + pad("─".repeat(col2 - 2), col2) + pad("─".repeat(col3 - 2), col3) + "─".repeat(20));

  for (const p of result.providers) {
    const status = p.validated ? "✔ valid" : "✘ unverified";
    const model = p.model ?? "—";
    const routes = p.routeCategories.length > 0 ? p.routeCategories.join(", ") : "—";
    lines.push(pad(p.name, col1) + pad(status, col2) + pad(model, col3) + routes);
  }

  lines.push(`\n${result.total} provider(s) configured`);
  return lines.join("\n");
}

/**
 * Format provider list as JSON.
 */
export function formatProviderListJson(result: ProviderListResult): string {
  return JSON.stringify(result, null, 2);
}

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}
