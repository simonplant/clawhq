/**
 * Append-only JSONL audit logger.
 *
 * Four log streams:
 *   - Tool execution: what the agent did
 *   - Egress: what data left the machine
 *   - Secret lifecycle: credential added/rotated/revoked
 *   - Approval resolution: high-stakes action approved/rejected
 *
 * Design: fire-and-forget — logging never throws, never disrupts the pipeline.
 */

import { join } from "node:path";

import { opsPath } from "../../config/ops-paths.js";
import { appendSecretLine } from "../fs-mode.js";

import type {
  ApprovalResolutionEvent,
  AuditTrailConfig,
  EgressEvent,
  SecretAction,
  SecretLifecycleEvent,
  ToolExecutionEvent,
} from "./types.js";

async function appendJsonl(filePath: string, entry: unknown): Promise<void> {
  // Delegate to the mode-enforcing helper. Node's `mode` option on
  // `appendFile` is silently ignored for existing files; appendSecretLine
  // does an explicit chmod on first write so the log lands at 0o600
  // regardless of umask or prior file state. Synchronous for simplicity —
  // audit writes are short and the fire-and-forget wrapper below swallows
  // any I/O errors.
  appendSecretLine(filePath, JSON.stringify(entry) + "\n");
}

// ── Tool Execution Logging ─────────────────────────────────────────────────

/** Log a tool execution event. Never throws. */
export async function logToolExecution(
  config: AuditTrailConfig,
  opts: {
    tool: string;
    action: string;
    status: ToolExecutionEvent["status"];
    durationMs: number;
    error?: string;
  },
): Promise<void> {
  try {
    const event: ToolExecutionEvent = {
      type: "tool_execution",
      ts: new Date().toISOString(),
      tool: opts.tool,
      action: opts.action.slice(0, 200),
      status: opts.status,
      durationMs: opts.durationMs,
      ...(opts.error ? { error: opts.error.slice(0, 500) } : {}),
    };
    await appendJsonl(config.toolLogPath, event);
  } catch {
    // Best-effort — audit logging never disrupts the pipeline
  }
}

// ── Egress Logging ─────────────────────────────────────────────────────────

/** Log an egress event. Never throws. */
export async function logEgressEvent(
  config: AuditTrailConfig,
  opts: {
    destination: string;
    protocol: string;
    bytesSent: number;
    integration: string;
    allowed: boolean;
  },
): Promise<void> {
  try {
    const event: EgressEvent = {
      type: "egress",
      ts: new Date().toISOString(),
      destination: opts.destination,
      protocol: opts.protocol,
      bytesSent: opts.bytesSent,
      integration: opts.integration,
      allowed: opts.allowed,
    };
    await appendJsonl(config.egressLogPath, event);
  } catch {
    // Best-effort — audit logging never disrupts the pipeline
  }
}

// ── Secret Lifecycle Logging ───────────────────────────────────────────────

/** Log a secret lifecycle event. Never throws. */
export async function logSecretEvent(
  config: AuditTrailConfig,
  opts: {
    secretId: string;
    action: SecretAction;
    actor: string;
  },
): Promise<void> {
  try {
    const event: SecretLifecycleEvent = {
      type: "secret_lifecycle",
      ts: new Date().toISOString(),
      secretId: opts.secretId,
      action: opts.action,
      actor: opts.actor,
    };
    await appendJsonl(config.secretLogPath, event);
  } catch {
    // Best-effort — audit logging never disrupts the pipeline
  }
}

// ── Approval Resolution Logging ───────────────────────────────────────────

/** Log an approval resolution event. Never throws. */
export async function logApprovalResolution(
  config: AuditTrailConfig,
  opts: {
    itemId: string;
    category: string;
    summary: string;
    resolution: "approved" | "rejected";
    resolvedVia: string;
    source: string;
  },
): Promise<void> {
  try {
    const event: ApprovalResolutionEvent = {
      type: "approval_resolution",
      ts: new Date().toISOString(),
      itemId: opts.itemId,
      category: opts.category,
      summary: opts.summary.slice(0, 200),
      resolution: opts.resolution,
      resolvedVia: opts.resolvedVia,
      source: opts.source,
    };
    await appendJsonl(config.approvalLogPath, event);
  } catch {
    // Best-effort — audit logging never disrupts the pipeline
  }
}

// ── Config Factory ─────────────────────────────────────────────────────────

/** Create an AuditTrailConfig from a deployment directory. */
export function createAuditConfig(deployDir: string, _hmacKey?: string): AuditTrailConfig {
  const auditDir = opsPath(deployDir, "audit");
  return {
    toolLogPath: join(auditDir, "tool-execution.jsonl"),
    egressLogPath: join(auditDir, "egress.jsonl"),
    secretLogPath: join(auditDir, "secret-lifecycle.jsonl"),
    approvalLogPath: join(auditDir, "approval-resolution.jsonl"),
  };
}
