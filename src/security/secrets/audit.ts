/**
 * Secret audit trail with HMAC chain.
 *
 * Append-only JSONL audit log for secret lifecycle events.
 * Each event is linked to the previous via HMAC-SHA256, forming
 * a tamper-evident chain.
 */

import { createHmac, randomBytes } from "node:crypto";
import { appendFile, chmod, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SecretAuditEventType = "added" | "rotated" | "revoked" | "accessed";

export interface SecretAuditEvent {
  /** Sequence number (1-based) */
  seq: number;
  /** Event type */
  event: SecretAuditEventType;
  /** Secret name (never the value) */
  secret_name: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** HMAC of the previous event (empty string for the first event) */
  prev_hmac: string;
  /** HMAC-SHA256(key, JSON(event_without_hmac) + prev_hmac) */
  hmac: string;
}

/** Result of verifying the audit chain. */
export interface AuditVerifyResult {
  valid: boolean;
  eventCount: number;
  errors: AuditVerifyError[];
}

export interface AuditVerifyError {
  seq: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Derive the audit log path from the .env file path. */
export function auditPath(envPath: string): string {
  return join(dirname(envPath), ".env.audit");
}

/** Derive the HMAC key path from the .env file path. */
export function auditKeyPath(envPath: string): string {
  return join(dirname(envPath), ".env.audit.key");
}

// ---------------------------------------------------------------------------
// HMAC key management
// ---------------------------------------------------------------------------

/**
 * Read or create the HMAC key for the audit chain.
 * Key is 32 random bytes stored base64-encoded with 600 permissions.
 */
export async function getOrCreateAuditKey(envPath: string): Promise<Buffer> {
  const keyPath = auditKeyPath(envPath);
  try {
    const data = await readFile(keyPath, "utf-8");
    return Buffer.from(data.trim(), "base64");
  } catch {
    // Key doesn't exist yet — generate one
    const key = randomBytes(32);
    await writeFile(keyPath, key.toString("base64") + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
    await chmod(keyPath, 0o600);
    return key;
  }
}

// ---------------------------------------------------------------------------
// HMAC computation
// ---------------------------------------------------------------------------

/**
 * Compute the HMAC for an audit event.
 *
 * hmac = HMAC-SHA256(key, JSON(event_without_hmac) + prev_hmac)
 */
export function computeEventHmac(
  key: Buffer,
  event: Omit<SecretAuditEvent, "hmac">,
): string {
  const payload = JSON.stringify(event) + event.prev_hmac;
  return createHmac("sha256", key).update(payload).digest("hex");
}

// ---------------------------------------------------------------------------
// Read audit events
// ---------------------------------------------------------------------------

/** Read all audit events from the JSONL file. Returns empty array if file doesn't exist. */
export async function readAuditEvents(envPath: string): Promise<SecretAuditEvent[]> {
  const path = auditPath(envPath);
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    return [];
  }

  const lines = content.trim().split("\n").filter((l) => l.length > 0);
  return lines.map((line) => JSON.parse(line) as SecretAuditEvent);
}

// ---------------------------------------------------------------------------
// Emit audit event
// ---------------------------------------------------------------------------

/**
 * Emit a secret audit event to the append-only JSONL log.
 * Computes HMAC chain linking to the previous event.
 */
export async function emitSecretAuditEvent(
  envPath: string,
  event: SecretAuditEventType,
  secretName: string,
): Promise<void> {
  const key = await getOrCreateAuditKey(envPath);
  const existing = await readAuditEvents(envPath);

  const seq = existing.length + 1;
  const prevHmac = existing.length > 0 ? existing[existing.length - 1].hmac : "";

  const partial: Omit<SecretAuditEvent, "hmac"> = {
    seq,
    event,
    secret_name: secretName,
    timestamp: new Date().toISOString(),
    prev_hmac: prevHmac,
  };

  const hmac = computeEventHmac(key, partial);
  const entry: SecretAuditEvent = { ...partial, hmac };

  const path = auditPath(envPath);
  await appendFile(path, JSON.stringify(entry) + "\n", "utf-8");

  // Ensure 600 permissions on audit file
  try {
    const s = await stat(path);
    if ((s.mode & 0o777) !== 0o600) {
      await chmod(path, 0o600);
    }
  } catch {
    // stat may fail on first write race — non-fatal
  }
}

// ---------------------------------------------------------------------------
// Chain verification
// ---------------------------------------------------------------------------

/**
 * Verify the HMAC chain integrity of the audit trail.
 * Re-reads the key and all events, recomputes each HMAC, and reports tampering.
 */
export async function verifyAuditChain(envPath: string): Promise<AuditVerifyResult> {
  let key: Buffer;
  try {
    const keyPath = auditKeyPath(envPath);
    const data = await readFile(keyPath, "utf-8");
    key = Buffer.from(data.trim(), "base64");
  } catch {
    return {
      valid: false,
      eventCount: 0,
      errors: [{ seq: 0, message: "Audit key file missing or unreadable" }],
    };
  }

  const events = await readAuditEvents(envPath);
  if (events.length === 0) {
    return { valid: true, eventCount: 0, errors: [] };
  }

  const errors: AuditVerifyError[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const expectedPrevHmac = i === 0 ? "" : events[i - 1].hmac;

    // Check prev_hmac linkage
    if (ev.prev_hmac !== expectedPrevHmac) {
      errors.push({
        seq: ev.seq,
        message: `prev_hmac mismatch: expected ${expectedPrevHmac.slice(0, 16)}..., got ${ev.prev_hmac.slice(0, 16)}...`,
      });
    }

    // Check sequence number
    if (ev.seq !== i + 1) {
      errors.push({
        seq: ev.seq,
        message: `Sequence gap: expected ${i + 1}, got ${ev.seq}`,
      });
    }

    // Recompute HMAC
    const partial: Omit<SecretAuditEvent, "hmac"> = {
      seq: ev.seq,
      event: ev.event,
      secret_name: ev.secret_name,
      timestamp: ev.timestamp,
      prev_hmac: ev.prev_hmac,
    };
    const recomputed = computeEventHmac(key, partial);
    if (recomputed !== ev.hmac) {
      errors.push({
        seq: ev.seq,
        message: `HMAC mismatch: event data has been tampered with`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    eventCount: events.length,
    errors,
  };
}
