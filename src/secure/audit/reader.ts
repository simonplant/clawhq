/**
 * Audit log reader — parse JSONL logs and produce audit reports.
 *
 * Reads the four audit streams and produces a unified AuditReport
 * with summary statistics. Supports time-range filtering.
 */

import { readFile } from "node:fs/promises";

import type {
  ApprovalResolutionEvent,
  AuditReport,
  AuditSummary,
  AuditTrailConfig,
  EgressEvent,
  SecretLifecycleEvent,
  ToolExecutionEvent,
} from "./types.js";

// ── Reader Options ─────────────────────────────────────────────────────────

export interface ReadAuditOptions {
  /** Only include events after this ISO timestamp. */
  readonly since?: string;
  /** Maximum number of events per stream. Most recent first. */
  readonly limit?: number;
}

// ── JSONL Parser ───────────────────────────────────────────────────────────

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

function filterByTime<T extends { ts: string }>(
  events: T[],
  since?: string,
): T[] {
  if (!since) return events;
  const cutoff = new Date(since).getTime();
  return events.filter((e) => new Date(e.ts).getTime() >= cutoff);
}

function limitEvents<T>(events: T[], limit?: number): T[] {
  if (!limit) return events;
  return events.slice(-limit);
}

// ── Report Builder ─────────────────────────────────────────────────────────

/** Read all audit logs and produce a unified report. */
export async function readAuditReport(
  config: AuditTrailConfig,
  opts: ReadAuditOptions = {},
): Promise<AuditReport> {
  const [rawTool, rawEgress, rawSecret, rawApproval] = await Promise.all([
    readJsonl<ToolExecutionEvent>(config.toolLogPath),
    readJsonl<EgressEvent>(config.egressLogPath),
    readJsonl<SecretLifecycleEvent>(config.secretLogPath),
    readJsonl<ApprovalResolutionEvent>(config.approvalLogPath),
  ]);

  const toolExecutions = limitEvents(filterByTime(rawTool, opts.since), opts.limit);
  const egressEvents = limitEvents(filterByTime(rawEgress, opts.since), opts.limit);
  const secretEvents = limitEvents(filterByTime(rawSecret, opts.since), opts.limit);
  const approvalEvents = limitEvents(filterByTime(rawApproval, opts.since), opts.limit);

  const summary: AuditSummary = {
    totalToolExecutions: toolExecutions.length,
    successfulExecutions: toolExecutions.filter((e) => e.status === "success").length,
    failedExecutions: toolExecutions.filter((e) => e.status !== "success").length,
    totalEgressEvents: egressEvents.length,
    allowedEgress: egressEvents.filter((e) => e.allowed).length,
    blockedEgress: egressEvents.filter((e) => !e.allowed).length,
    totalSecretEvents: secretEvents.length,
    totalApprovalEvents: approvalEvents.length,
    approvedCount: approvalEvents.filter((e) => e.resolution === "approved").length,
    rejectedCount: approvalEvents.filter((e) => e.resolution === "rejected").length,
  };

  return {
    timestamp: new Date().toISOString(),
    toolExecutions,
    egressEvents,
    secretEvents,
    approvalEvents,
    summary,
  };
}
