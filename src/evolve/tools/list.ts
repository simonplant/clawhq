/**
 * List installed tools with formatting for CLI display.
 */

import { availableToolNames } from "./registry.js";
import type { ToolListResult } from "./types.js";

/**
 * Format tool list for terminal display.
 */
export function formatToolList(result: ToolListResult): string {
  if (result.total === 0) {
    const available = availableToolNames().join(", ");
    return `No tools installed. Use 'clawhq tool install <name>' to add one.\n\nAvailable: ${available}`;
  }

  const lines: string[] = [];
  lines.push(`Installed tools: ${result.total}\n`);
  lines.push(padRight("NAME", 25) + padRight("SOURCE", 15) + "INSTALLED");
  lines.push("─".repeat(55));

  for (const tool of result.tools) {
    const name = padRight(tool.name, 25);
    const source = padRight(tool.source, 15);
    const date = tool.installedAt
      ? new Date(tool.installedAt).toLocaleDateString()
      : "—";
    lines.push(`${name}${source}${date}`);
  }

  return lines.join("\n");
}

/**
 * Format tool list as JSON for programmatic consumption.
 */
export function formatToolListJson(result: ToolListResult): string {
  return JSON.stringify(
    {
      total: result.total,
      tools: result.tools,
    },
    null,
    2,
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}
