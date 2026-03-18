/**
 * Audit log appender.
 *
 * Appends AuditEntry records to ~/.clawhq/audit.jsonl (newline-delimited JSON).
 * Exported so agent execution paths can call it to log tool invocations.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { AuditEntry } from "./types.js";

/** Default audit log path. */
export const DEFAULT_AUDIT_LOG = "~/.clawhq/audit.jsonl";

/** Resolve ~ to HOME directory. */
function resolvePath(p: string): string {
  return p.replace(/^~/, process.env.HOME ?? "~");
}

/**
 * Append a single audit entry to the JSONL log file.
 *
 * Creates the parent directory if it doesn't exist.
 * Each entry is written as a single JSON line followed by a newline.
 */
export async function appendAuditEntry(
  entry: AuditEntry,
  logPath: string = DEFAULT_AUDIT_LOG,
): Promise<void> {
  const resolved = resolvePath(logPath);
  await mkdir(dirname(resolved), { recursive: true });
  const line = JSON.stringify(entry) + "\n";
  await appendFile(resolved, line, "utf-8");
}
