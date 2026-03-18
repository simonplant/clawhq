/**
 * Audit logging and quarantine for the sanitizer.
 * Append-only JSONL files for threat events and quarantined content.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { Threat } from "./detect.js";
import { threatScore } from "./sanitize.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AuditEntry {
  readonly ts: string;
  readonly source: string;
  readonly action: "sanitized" | "quarantined" | "detected";
  readonly score: number;
  readonly threatCount: number;
  readonly categories: string[];
  readonly preview: string;
}

export interface QuarantineEntry {
  readonly ts: string;
  readonly source: string;
  readonly score: number;
  readonly threats: Array<{
    category: string;
    tier: number;
    detail: string;
    severity: string;
  }>;
  readonly content: string;
}

export interface AuditConfig {
  /** Path to the JSONL audit log. */
  readonly auditPath: string;
  /** Path to the JSONL quarantine file. */
  readonly quarantinePath: string;
}

// ── Logging ─────────────────────────────────────────────────────────────────

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

/** Append a threat event to the audit log. Never throws. */
export async function writeAuditLog(
  config: AuditConfig,
  source: string,
  threats: readonly Threat[],
  textPreview: string,
  action: AuditEntry["action"],
): Promise<void> {
  try {
    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      source,
      action,
      score: Math.round(threatScore(threats) * 100) / 100,
      threatCount: threats.length,
      categories: [...new Set(threats.map((t) => t.category))],
      preview: textPreview.slice(0, 120),
    };
    await appendJsonl(config.auditPath, entry);
  } catch {
    // Audit logging must never disrupt the pipeline
  }
}

/** Write full content to quarantine for manual review. Never throws. */
export async function writeQuarantine(
  config: AuditConfig,
  source: string,
  text: string,
  threats: readonly Threat[],
): Promise<void> {
  try {
    const entry: QuarantineEntry = {
      ts: new Date().toISOString(),
      source,
      score: Math.round(threatScore(threats) * 100) / 100,
      threats: threats.map((t) => ({
        category: t.category,
        tier: t.tier,
        detail: t.detail,
        severity: t.severity,
      })),
      content: text.slice(0, 2000),
    };
    await appendJsonl(config.quarantinePath, entry);
  } catch {
    // Quarantine logging must never disrupt the pipeline
  }
}
