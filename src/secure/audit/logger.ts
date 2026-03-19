/**
 * Append-only JSONL audit logger.
 *
 * Three log streams:
 *   - Tool execution: what the agent did
 *   - Egress: what data left the machine
 *   - Secret lifecycle: HMAC-chained for tamper evidence
 *
 * Design: fire-and-forget — logging never throws, never disrupts the pipeline.
 * Follows the pattern established in sanitizer/audit.ts.
 */

import { createHmac } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  ApprovalResolutionEvent,
  AuditTrailConfig,
  EgressEvent,
  SecretAction,
  SecretLifecycleEvent,
  ToolExecutionEvent,
} from "./types.js";

// ── Directory Cache ────────────────────────────────────────────────────────

const ensuredDirs = new Set<string>();

async function ensureDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  if (ensuredDirs.has(dir)) return;
  await mkdir(dir, { recursive: true });
  ensuredDirs.add(dir);
}

async function appendJsonl(filePath: string, entry: unknown): Promise<void> {
  await ensureDir(filePath);
  await appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

// ── Sequence Counter ───────────────────────────────────────────────────────

const seqCounters = new Map<string, number>();

function nextSeq(logPath: string): number {
  const current = seqCounters.get(logPath) ?? 0;
  const next = current + 1;
  seqCounters.set(logPath, next);
  return next;
}

/** Initialize sequence counter from existing log file line count. */
export async function initSeqCounter(logPath: string): Promise<void> {
  try {
    const content = await readFile(logPath, "utf-8");
    const lines = content.trim().split("\n").filter((l) => l.length > 0);
    seqCounters.set(logPath, lines.length);
  } catch (err) {
    console.warn(`[secure/audit] Failed to init sequence counter from ${logPath}`, err);
    seqCounters.set(logPath, 0);
  }
}

// ── HMAC Chaining ──────────────────────────────────────────────────────────

/** Last known HMAC for the secret lifecycle chain. */
let lastSecretHmac = "";

/** Compute HMAC-SHA256 of event data chained with the previous HMAC. */
function computeChainedHmac(
  key: string,
  prevHmac: string,
  data: Record<string, unknown>,
): string {
  const payload = prevHmac + JSON.stringify(data);
  return createHmac("sha256", key).update(payload).digest("hex");
}

/** Initialize the HMAC chain from the last entry in an existing log. */
export async function initHmacChain(logPath: string): Promise<void> {
  try {
    const content = await readFile(logPath, "utf-8");
    const lines = content.trim().split("\n").filter((l) => l.length > 0);
    if (lines.length > 0) {
      const last = JSON.parse(lines[lines.length - 1]) as SecretLifecycleEvent;
      lastSecretHmac = last.hmac;
    }
  } catch (err) {
    console.warn(`[secure/audit] Failed to init HMAC chain from ${logPath}`, err);
    lastSecretHmac = "";
  }
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
      seq: nextSeq(config.toolLogPath),
      tool: opts.tool,
      action: opts.action.slice(0, 200),
      status: opts.status,
      durationMs: opts.durationMs,
      ...(opts.error ? { error: opts.error.slice(0, 500) } : {}),
    };
    await appendJsonl(config.toolLogPath, event);
  } catch (err) {
    console.warn("[secure/audit] Failed to write tool execution log", err);
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
      seq: nextSeq(config.egressLogPath),
      destination: opts.destination,
      protocol: opts.protocol,
      bytesSent: opts.bytesSent,
      integration: opts.integration,
      allowed: opts.allowed,
    };
    await appendJsonl(config.egressLogPath, event);
  } catch (err) {
    console.warn("[secure/audit] Failed to write egress log", err);
  }
}

// ── Secret Lifecycle Logging ───────────────────────────────────────────────

/** Log a secret lifecycle event with HMAC chaining. Never throws. */
export async function logSecretEvent(
  config: AuditTrailConfig,
  opts: {
    secretId: string;
    action: SecretAction;
    actor: string;
  },
): Promise<void> {
  try {
    const prevHmac = lastSecretHmac;
    const eventData = {
      type: "secret_lifecycle" as const,
      ts: new Date().toISOString(),
      seq: nextSeq(config.secretLogPath),
      secretId: opts.secretId,
      action: opts.action,
      actor: opts.actor,
    };

    const hmac = computeChainedHmac(config.hmacKey, prevHmac, eventData);
    lastSecretHmac = hmac;

    const event: SecretLifecycleEvent = {
      ...eventData,
      hmac,
      prevHmac,
    };
    await appendJsonl(config.secretLogPath, event);
  } catch (err) {
    console.warn("[secure/audit] Failed to write secret lifecycle log", err);
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
      seq: nextSeq(config.approvalLogPath),
      itemId: opts.itemId,
      category: opts.category,
      summary: opts.summary.slice(0, 200),
      resolution: opts.resolution,
      resolvedVia: opts.resolvedVia,
      source: opts.source,
    };
    await appendJsonl(config.approvalLogPath, event);
  } catch (err) {
    console.warn("[secure/audit] Failed to write approval resolution log", err);
  }
}

// ── Config Factory ─────────────────────────────────────────────────────────

/** Create an AuditTrailConfig from a deployment directory. */
export function createAuditConfig(deployDir: string, hmacKey: string): AuditTrailConfig {
  const auditDir = join(deployDir, "ops", "audit");
  return {
    toolLogPath: join(auditDir, "tool-execution.jsonl"),
    egressLogPath: join(auditDir, "egress.jsonl"),
    secretLogPath: join(auditDir, "secret-lifecycle.jsonl"),
    approvalLogPath: join(auditDir, "approval-resolution.jsonl"),
    hmacKey,
  };
}
