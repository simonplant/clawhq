/**
 * Tool command output formatting.
 */

import type { ToolListEntry } from "./tool.js";

/**
 * Format the tool list as a human-readable table.
 */
export function formatToolList(entries: ToolListEntry[]): string {
  const lines = ["CLI Tools:", ""];

  // Table header
  lines.push(
    padRight("Name", 16)
    + padRight("Status", 18)
    + "Description",
  );
  lines.push("-".repeat(76));

  for (const entry of entries) {
    let status: string;
    if (entry.alwaysIncluded) {
      status = "always included";
    } else if (entry.installed) {
      status = "installed";
    } else {
      status = "available";
    }

    lines.push(
      padRight(entry.name, 16)
      + padRight(status, 18)
      + entry.description,
    );
  }

  const installed = entries.filter((e) => e.installed).length;
  const available = entries.filter((e) => !e.installed).length;
  lines.push("");
  lines.push(`${installed} installed, ${available} available`);

  return lines.join("\n");
}

function padRight(str: string, width: number): string {
  return str.length >= width ? str + " " : str + " ".repeat(width - str.length);
}
