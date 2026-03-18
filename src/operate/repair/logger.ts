/**
 * Repair audit logger — logs all auto-repair actions for audit trail.
 *
 * Writes repair events to a JSONL file at {openclawHome}/repair.log.
 * Each line is a self-contained JSON object for easy parsing and tailing.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RepairActionResult, RepairLogEntry } from "./types.js";

/**
 * Append a repair action result to the audit log.
 */
export async function logRepairAction(
  openclawHome: string,
  result: RepairActionResult,
): Promise<void> {
  const logPath = join(openclawHome, "repair.log");
  const entry: RepairLogEntry = {
    timestamp: new Date().toISOString(),
    issue: result.issue,
    action: result.action,
    status: result.status,
    message: result.message,
    durationMs: result.durationMs,
  };

  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Read the repair audit log.
 *
 * Returns entries in chronological order. Returns empty array if
 * the log file does not exist.
 */
export async function readRepairLog(
  openclawHome: string,
): Promise<RepairLogEntry[]> {
  const logPath = join(openclawHome, "repair.log");

  try {
    const content = await readFile(logPath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RepairLogEntry);
  } catch {
    return [];
  }
}
