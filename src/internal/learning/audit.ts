/**
 * Audit trail for preference learning — logs all preference changes
 * for transparency and debugging.
 *
 * Append-only log stored as JSON in the ClawHQ data directory.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AuditEntry, AuditEventType, AuditLog, LearningContext } from "./types.js";

const AUDIT_FILE = "preference-audit.json";

function auditPath(ctx: LearningContext): string {
  return join(ctx.clawhqDir, "learning", AUDIT_FILE);
}

async function ensureDir(ctx: LearningContext): Promise<void> {
  await mkdir(join(ctx.clawhqDir, "learning"), { recursive: true });
}

/** Load the audit log from disk. */
export async function loadAuditLog(ctx: LearningContext): Promise<AuditLog> {
  try {
    const content = await readFile(auditPath(ctx), "utf-8");
    return JSON.parse(content) as AuditLog;
  } catch {
    return { entries: [] };
  }
}

/** Save the audit log to disk. */
async function saveAuditLog(
  ctx: LearningContext,
  log: AuditLog,
): Promise<void> {
  await ensureDir(ctx);
  await writeFile(
    auditPath(ctx),
    JSON.stringify(log, null, 2) + "\n",
    "utf-8",
  );
}

/** Append a new entry to the audit log. */
export async function logEvent(
  ctx: LearningContext,
  eventType: AuditEventType,
  description: string,
  relatedId: string,
): Promise<AuditEntry> {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    eventType,
    description,
    relatedId,
  };

  const log = await loadAuditLog(ctx);
  log.entries.push(entry);
  await saveAuditLog(ctx, log);

  return entry;
}

/** Get all audit entries, optionally filtered by event type. */
export async function getAuditEntries(
  ctx: LearningContext,
  filterType?: AuditEventType,
): Promise<AuditEntry[]> {
  const log = await loadAuditLog(ctx);
  if (filterType) {
    return log.entries.filter((e) => e.eventType === filterType);
  }
  return log.entries;
}
