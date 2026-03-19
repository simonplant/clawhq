/**
 * OWASP-compatible audit export.
 *
 * Produces a normalized JSON document that maps ClawHQ's three audit streams
 * into a standardized format suitable for compliance reporting and SIEM ingestion.
 */

import type {
  ApprovalResolutionEvent,
  AuditReport,
  EgressEvent,
  OwaspEvent,
  OwaspExport,
  SecretLifecycleEvent,
  ToolExecutionEvent,
} from "./types.js";

// ── Export ──────────────────────────────────────────────────────────────────

/** Build an OWASP-compatible export from an audit report. */
export function buildOwaspExport(
  report: AuditReport,
  deployDir: string,
): OwaspExport {
  const events: OwaspEvent[] = [
    ...report.toolExecutions.map(mapToolEvent),
    ...report.egressEvents.map(mapEgressEvent),
    ...report.secretEvents.map(mapSecretEvent),
    ...report.approvalEvents.map(mapApprovalEvent),
  ];

  // Sort all events by timestamp
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Determine time range
  const timestamps = events.map((e) => e.timestamp);
  const from = timestamps[0] ?? report.timestamp;
  const to = timestamps[timestamps.length - 1] ?? report.timestamp;

  return {
    version: "1.0",
    generator: "clawhq",
    generatedAt: report.timestamp,
    metadata: {
      deployDir,
      period: { from, to },
    },
    events,
  };
}

// ── Mappers ────────────────────────────────────────────────────────────────

function mapToolEvent(event: ToolExecutionEvent): OwaspEvent {
  return {
    timestamp: event.ts,
    category: "tool-execution",
    action: `${event.tool}:${event.action}`,
    outcome: event.status === "success" ? "success" : "failure",
    actor: "agent",
    target: event.tool,
    details: {
      durationMs: event.durationMs,
      ...(event.error ? { error: event.error } : {}),
    },
  };
}

function mapEgressEvent(event: EgressEvent): OwaspEvent {
  return {
    timestamp: event.ts,
    category: "data-egress",
    action: `${event.protocol}://${event.destination}`,
    outcome: event.allowed ? "success" : "blocked",
    actor: event.integration,
    target: event.destination,
    details: {
      bytesSent: event.bytesSent,
      protocol: event.protocol,
    },
  };
}

function mapSecretEvent(event: SecretLifecycleEvent): OwaspEvent {
  return {
    timestamp: event.ts,
    category: "secret-lifecycle",
    action: event.action,
    outcome: "success",
    actor: event.actor,
    target: event.secretId,
    details: {
      hmacValid: true,
    },
  };
}

function mapApprovalEvent(event: ApprovalResolutionEvent): OwaspEvent {
  return {
    timestamp: event.ts,
    category: "approval-resolution",
    action: `${event.category}:${event.resolution}`,
    outcome: event.resolution === "approved" ? "success" : "blocked",
    actor: event.resolvedVia,
    target: event.itemId,
    details: {
      summary: event.summary,
      source: event.source,
    },
  };
}
