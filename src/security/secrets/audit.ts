/**
 * Secret audit event emitter.
 *
 * Writes append-only JSONL audit events for secret lifecycle actions.
 * Consumed by the audit trail feature (FEAT-046).
 */

import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SecretAuditEventType = "added" | "rotated" | "revoked" | "accessed";

export interface SecretAuditEvent {
  /** Event type */
  event: SecretAuditEventType;
  /** Secret name (never the value) */
  secret_name: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Derive the audit log path from the .env file path.
 * Places the audit log alongside .env as .env.audit.
 */
function auditPath(envPath: string): string {
  return join(dirname(envPath), ".env.audit");
}

/**
 * Emit a secret audit event to the append-only JSONL log.
 */
export async function emitSecretAuditEvent(
  envPath: string,
  event: SecretAuditEventType,
  secretName: string,
): Promise<void> {
  const entry: SecretAuditEvent = {
    event,
    secret_name: secretName,
    timestamp: new Date().toISOString(),
  };
  await appendFile(auditPath(envPath), JSON.stringify(entry) + "\n", "utf-8");
}
