/**
 * Audit log reader.
 *
 * Reads and filters the tool execution audit log (~/.clawhq/audit.jsonl).
 * Supports filtering by date range, tool name, and result limiting.
 */

import { readFile } from "node:fs/promises";

import type { AuditEntry, AuditQueryOptions } from "./types.js";

/** Default audit log path. */
const DEFAULT_AUDIT_LOG = "~/.clawhq/audit.jsonl";

/** Resolve ~ to HOME directory. */
function resolvePath(p: string): string {
  return p.replace(/^~/, process.env.HOME ?? "~");
}

/**
 * Parse the audit JSONL file into AuditEntry records.
 *
 * Returns an empty array if the file doesn't exist or is empty.
 * Malformed lines are silently skipped.
 */
export async function parseAuditLog(logPath: string = DEFAULT_AUDIT_LOG): Promise<AuditEntry[]> {
  const resolved = resolvePath(logPath);
  let content: string;
  try {
    content = await readFile(resolved, "utf-8");
  } catch {
    return [];
  }

  const entries: AuditEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      entries.push({
        timestamp: String(raw.timestamp ?? ""),
        sessionId: raw.sessionId != null ? String(raw.sessionId) : undefined,
        toolName: String(raw.toolName ?? "unknown"),
        redactedInputs: (raw.redactedInputs as Record<string, unknown>) ?? {},
        summarizedOutput: String(raw.summarizedOutput ?? ""),
        durationMs: Number(raw.durationMs ?? 0),
      });
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Query the audit log with optional filters.
 *
 * Results are returned in reverse chronological order (newest first).
 */
export async function queryAuditLog(
  opts: AuditQueryOptions = {},
  logPath: string = DEFAULT_AUDIT_LOG,
): Promise<AuditEntry[]> {
  let entries = await parseAuditLog(logPath);

  // Filter by date
  if (opts.since) {
    const sinceMs = new Date(opts.since).getTime();
    entries = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceMs);
  }

  // Filter by tool name
  if (opts.toolName) {
    const name = opts.toolName.toLowerCase();
    entries = entries.filter((e) => e.toolName.toLowerCase() === name);
  }

  // Reverse chronological order
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Apply limit
  if (opts.limit != null && opts.limit > 0) {
    entries = entries.slice(0, opts.limit);
  }

  return entries;
}
