/**
 * Tool execution audit trail.
 *
 * Appends tool invocations to a local JSONL log file and reads them back
 * with filtering. Distinct from egress audit (outbound network calls) —
 * this covers ALL tool invocations including local tools (tasks, calendar,
 * email, etc.).
 *
 * Log file: ~/.openclaw/tool-audit.log (one JSON object per line)
 */

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────────

/** A single tool execution audit entry. */
export interface ToolAuditEntry {
  /** Monotonically increasing sequence number within the log. */
  seq: number;
  /** ISO 8601 timestamp of invocation. */
  timestamp: string;
  /** Tool name (e.g. "email", "tasks", "calendar", "tavily"). */
  tool: string;
  /** Redacted summary of input (secrets/PII masked). */
  inputRedacted: string;
  /** Summarized output (truncated for log size). */
  outputSummary: string;
  /** Execution duration in milliseconds. */
  durationMs: number;
  /** Whether the tool executed successfully. */
  status: "success" | "error";
  /** Optional agent ID that invoked the tool. */
  agentId?: string;
  /** Optional session ID. */
  sessionId?: string;
}

/** Options for reading the tool audit log. */
export interface ToolAuditReadOptions {
  /** Path to the tool audit log file. */
  logPath?: string;
  /** OpenClaw home directory (default: ~/.openclaw). */
  openclawHome?: string;
  /** Only include entries since this date (ISO 8601). */
  since?: string | null;
  /** Only include entries until this date (ISO 8601). */
  until?: string | null;
  /** Filter by tool name. */
  tool?: string;
  /** Maximum number of entries to return (most recent first). */
  limit?: number;
}

/** Summary statistics for a tool audit report. */
export interface ToolAuditSummary {
  totalExecutions: number;
  successCount: number;
  errorCount: number;
  byTool: Record<string, ToolSummary>;
  avgDurationMs: number;
}

export interface ToolSummary {
  executions: number;
  successes: number;
  errors: number;
  avgDurationMs: number;
}

/** Full tool audit report. */
export interface ToolAuditReport {
  since: string | null;
  until: string;
  entries: ToolAuditEntry[];
  summary: ToolAuditSummary;
}

// ── Constants ──────────────────────────────────────────────────────

export const TOOL_AUDIT_FILENAME = "tool-audit.log";

const MAX_INPUT_LENGTH = 200;
const MAX_OUTPUT_LENGTH = 200;

// ── Redaction ──────────────────────────────────────────────────────

/** Patterns that should be redacted from audit log inputs. */
const REDACT_PATTERNS = [
  /(?:sk-ant-|sk-)[A-Za-z0-9_-]{20,}/g,       // Anthropic/OpenAI keys
  /ghp_[A-Za-z0-9_]{36,}/g,                     // GitHub PAT
  /AKIA[A-Z0-9]{16}/g,                           // AWS access key
  /(?:Bearer\s+)[A-Za-z0-9._\-/+=]{20,}/gi,     // Bearer tokens
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, // Email addresses
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,             // SSN-like patterns
];

/** Redact known secret/PII patterns from a string. */
export function redactSecrets(input: string): string {
  let result = input;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/** Truncate a string to a maximum length. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

// ── Appender ───────────────────────────────────────────────────────

/** Resolve the tool audit log path. */
export function resolveLogPath(openclawHome?: string): string {
  const home = (openclawHome ?? "~/.openclaw").replace(
    /^~/,
    process.env.HOME ?? "~",
  );
  return join(home, TOOL_AUDIT_FILENAME);
}

/**
 * Append a tool execution entry to the audit log.
 *
 * Input is redacted and truncated before writing. Output is truncated.
 * This function is fire-and-forget safe — errors are swallowed so audit
 * logging never breaks tool execution.
 */
export async function appendToolAudit(
  entry: Omit<ToolAuditEntry, "seq" | "inputRedacted" | "outputSummary"> & {
    input: string;
    output: string;
  },
  openclawHome?: string,
): Promise<void> {
  const logPath = resolveLogPath(openclawHome);

  const record: ToolAuditEntry = {
    seq: Date.now(), // monotonic-enough for append-only log
    timestamp: entry.timestamp,
    tool: entry.tool,
    inputRedacted: truncate(redactSecrets(entry.input), MAX_INPUT_LENGTH),
    outputSummary: truncate(entry.output, MAX_OUTPUT_LENGTH),
    durationMs: entry.durationMs,
    status: entry.status,
    agentId: entry.agentId,
    sessionId: entry.sessionId,
  };

  const line = JSON.stringify(record) + "\n";
  await appendFile(logPath, line, "utf-8");
}

// ── Reader ─────────────────────────────────────────────────────────

/** Parse tool audit log entries from a JSONL file. */
export async function readToolAuditLog(logPath: string): Promise<ToolAuditEntry[]> {
  let content: string;
  try {
    content = await readFile(logPath, "utf-8");
  } catch {
    return [];
  }

  const entries: ToolAuditEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      entries.push({
        seq: Number(raw.seq ?? 0),
        timestamp: String(raw.timestamp ?? ""),
        tool: String(raw.tool ?? "unknown"),
        inputRedacted: String(raw.inputRedacted ?? ""),
        outputSummary: String(raw.outputSummary ?? ""),
        durationMs: Number(raw.durationMs ?? 0),
        status: raw.status === "error" ? "error" : "success",
        agentId: raw.agentId != null ? String(raw.agentId) : undefined,
        sessionId: raw.sessionId != null ? String(raw.sessionId) : undefined,
      });
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/** Filter entries by time range. */
function filterByTimeRange(
  entries: ToolAuditEntry[],
  since: string | null,
  until: string,
): ToolAuditEntry[] {
  const sinceMs = since ? new Date(since).getTime() : 0;
  const untilMs = new Date(until).getTime();

  return entries.filter((e) => {
    const ts = new Date(e.timestamp).getTime();
    return ts >= sinceMs && ts <= untilMs;
  });
}

/** Build summary statistics from entries. */
function buildSummary(entries: ToolAuditEntry[]): ToolAuditSummary {
  const byTool: Record<string, ToolSummary> = {};
  let successCount = 0;
  let errorCount = 0;
  let totalDuration = 0;

  for (const entry of entries) {
    if (entry.status === "success") successCount++;
    else errorCount++;
    totalDuration += entry.durationMs;

    if (!byTool[entry.tool]) {
      byTool[entry.tool] = { executions: 0, successes: 0, errors: 0, avgDurationMs: 0 };
    }
    const ts = byTool[entry.tool];
    ts.executions++;
    if (entry.status === "success") ts.successes++;
    else ts.errors++;
  }

  // Compute per-tool averages
  for (const ts of Object.values(byTool)) {
    const toolEntries = entries.filter((e) => {
      const t = byTool[e.tool];
      return t === ts;
    });
    const toolDuration = toolEntries.reduce((sum, e) => sum + e.durationMs, 0);
    ts.avgDurationMs = ts.executions > 0 ? Math.round(toolDuration / ts.executions) : 0;
  }

  return {
    totalExecutions: entries.length,
    successCount,
    errorCount,
    byTool,
    avgDurationMs: entries.length > 0 ? Math.round(totalDuration / entries.length) : 0,
  };
}

/**
 * Collect a full tool audit report.
 */
export async function collectToolAudit(
  options: ToolAuditReadOptions = {},
): Promise<ToolAuditReport> {
  const logPath = options.logPath ?? resolveLogPath(options.openclawHome);
  const until = options.until ?? new Date().toISOString();
  const since = options.since ?? null;

  let entries = await readToolAuditLog(logPath);
  entries = filterByTimeRange(entries, since, until);

  if (options.tool) {
    entries = entries.filter((e) => e.tool === options.tool);
  }

  // Sort by timestamp descending (most recent first)
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (options.limit && options.limit > 0) {
    entries = entries.slice(0, options.limit);
  }

  const summary = buildSummary(entries);

  return { since, until, entries, summary };
}
