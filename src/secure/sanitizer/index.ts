/**
 * Input sanitizer — prompt injection firewall for agent infrastructure.
 *
 * Filters, flags, and quarantines malicious content before it reaches LLM context.
 * Catches deterministic encoding tricks and known injection patterns.
 * For adversarial prompt injection, use model-based detection.
 */

// High-level API (primary consumer interface)
export { sanitizeContent, sanitizeContentSync, sanitizeJson } from "./sanitizer.js";
export type { SanitizeContentOptions, SanitizeResult } from "./sanitizer.js";

// Detection engine
export { detectThreats, normalizeConfusables } from "./detect.js";
export type { Threat, ThreatCategory, ThreatSeverity, NormalizeResult } from "./detect.js";

// Sanitization primitives
export { sanitize, threatScore, wrapUntrusted } from "./sanitize.js";
export type { SanitizeOptions } from "./sanitize.js";

// Audit
export { writeAuditLog, writeQuarantine } from "./audit.js";
export type { AuditConfig, AuditEntry, QuarantineEntry } from "./audit.js";
