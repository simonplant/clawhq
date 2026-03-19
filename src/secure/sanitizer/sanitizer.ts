/**
 * High-level sanitizer API. Single entry point for all consumers.
 *
 * Pipeline: detect → audit log → sanitize or quarantine → optionally wrap.
 *
 * Usage:
 *   import { sanitizeContent, sanitizeJson } from "./secure/sanitizer/index.js";
 *
 *   const clean = await sanitizeContent(text, { source: "email" });
 *   const data  = await sanitizeJson(obj, ["title", "body"], { source: "api" });
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { writeAuditLog, writeQuarantine, type AuditConfig } from "./audit.js";
import { detectThreats, type Threat } from "./detect.js";
import { sanitize, threatScore, wrapUntrusted } from "./sanitize.js";

// ── Configuration ───────────────────────────────────────────────────────────

/** Score at or above which content is quarantined instead of sanitized. */
const QUARANTINE_THRESHOLD = 0.6;

const DEFAULT_OPS_DIR = join(
  homedir(),
  ".clawhq",
  "ops",
  "security",
);

function defaultAuditConfig(): AuditConfig {
  return {
    auditPath: join(DEFAULT_OPS_DIR, "sanitizer-audit.jsonl"),
    quarantinePath: join(DEFAULT_OPS_DIR, "sanitizer-quarantine.jsonl"),
  };
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface SanitizeContentOptions {
  /** Label for audit log entries (e.g. "email", "rss", "api"). */
  readonly source?: string;
  /** Strip encoded blobs in addition to injection patterns. */
  readonly strict?: boolean;
  /** Wrap output with data-boundary markers for LLM context. */
  readonly wrap?: boolean;
  /** Write threat events to audit log. Default: true. */
  readonly log?: boolean;
  /** Quarantine high-severity content. Default: true. */
  readonly quarantine?: boolean;
  /** Override default audit file paths. */
  readonly audit?: AuditConfig;
}

// ── Result ──────────────────────────────────────────────────────────────────

export interface SanitizeResult {
  /** Cleaned (or quarantine-notice) text. */
  readonly text: string;
  /** Threats detected in the original input. */
  readonly threats: readonly Threat[];
  /** Aggregate threat score 0.0–1.0. */
  readonly score: number;
  /** Whether the content was quarantined. */
  readonly quarantined: boolean;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Sanitize a single string (sync). Detect → sanitize/quarantine → wrap.
 * No audit logging. Use this on hot paths where async is not acceptable.
 */
export function sanitizeContentSync(
  text: string,
  options: Omit<SanitizeContentOptions, "log" | "audit"> = {},
): SanitizeResult {
  const { source = "external", strict = false, wrap = false, quarantine = true } = options;

  const threats = detectThreats(text);
  const score = threatScore(threats);
  const shouldQuarantine = quarantine && score >= QUARANTINE_THRESHOLD;

  if (shouldQuarantine) {
    const notice =
      `[Sanitizer: content quarantined — ${threats.length} threat(s), ` +
      `score ${score.toFixed(1)}, source: ${source}]`;
    return {
      text: wrap ? wrapUntrusted(notice, source) : notice,
      threats,
      score,
      quarantined: true,
    };
  }

  let cleaned = threats.length > 0 ? sanitize(text, { strict }) : text;
  if (wrap) {
    cleaned = wrapUntrusted(cleaned, source);
  }

  return { text: cleaned, threats, score, quarantined: false };
}

/**
 * Sanitize a single string (async). Detect → log → sanitize/quarantine → wrap.
 * Includes audit logging. Prefer `sanitizeContentSync` when logging is not needed.
 */
export async function sanitizeContent(
  text: string,
  options: SanitizeContentOptions = {},
): Promise<SanitizeResult> {
  const {
    source = "external",
    log = true,
    quarantine = true,
    audit = defaultAuditConfig(),
  } = options;

  const result = sanitizeContentSync(text, options);

  // Audit log (fire-and-forget, never blocks)
  if (result.threats.length > 0 && log) {
    const action = result.quarantined ? "quarantined" : "sanitized";
    writeAuditLog(audit, source, result.threats, text, action).catch(() => {});
  }

  // Quarantine log
  if (result.quarantined && quarantine && log) {
    writeQuarantine(audit, source, text, result.threats).catch(() => {});
  }

  return result;
}

/**
 * Sanitize specific string fields in a JSON structure.
 * Recurses into arrays. Returns a shallow copy with sanitized fields — input is not mutated.
 */
export async function sanitizeJson<T>(
  data: T,
  fields: readonly string[],
  options: SanitizeContentOptions = {},
): Promise<T> {
  if (Array.isArray(data)) {
    const results = await Promise.all(
      data.map((item) => sanitizeJson(item, fields, options)),
    );
    return results as T;
  }

  if (data !== null && typeof data === "object") {
    const input = data as Record<string, unknown>;
    const output = { ...input };
    for (const field of fields) {
      if (field in output && typeof output[field] === "string") {
        const result = await sanitizeContent(output[field] as string, {
          ...options,
          wrap: false, // wrap per-field would break JSON structure
        });
        output[field] = result.text;
      }
    }
    return output as T;
  }

  return data;
}
