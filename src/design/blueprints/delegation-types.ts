/**
 * Delegated action rules — blueprint-level pre-approved action categories
 * with pattern matching.
 *
 * Delegation rules define what an agent can do without asking. Each category
 * groups related rules under a tool, and each rule supports glob-style
 * pattern matching on action names and optional field conditions.
 *
 * At compile time, delegation rules are resolved into a flat
 * `delegated-rules.json` file that the agent reads at runtime.
 */

import type { DelegationTier } from "./types.js";

// ── Pattern Matching ────────────────────────────────────────────────────────

/**
 * A condition that must match for a delegation rule to apply.
 *
 * Supports glob-style patterns (`*` matches any substring).
 * Example: `{ field: "recipient", pattern: "*@company.com" }`
 */
export interface DelegationMatch {
  /** Field name to match against (e.g. "recipient", "subject", "sender"). */
  readonly field: string;
  /** Glob pattern to match the field value against. `*` matches any substring. */
  readonly pattern: string;
}

// ── Rules ───────────────────────────────────────────────────────────────────

/**
 * A single delegation rule with pattern matching support.
 *
 * The `action` field supports glob patterns:
 * - `"email:send:*"` matches any email send action
 * - `"calendar:update:recurring"` matches a specific action
 * - `"*"` matches all actions in the category
 */
export interface DelegationRuleEntry {
  /** Action pattern — supports `*` glob matching. */
  readonly action: string;
  /** Which tier this action falls into. */
  readonly tier: DelegationTier;
  /** Human-readable description of what this rule allows. */
  readonly description: string;
  /** Optional conditions that must all match for the rule to apply. */
  readonly match?: readonly DelegationMatch[];
}

// ── Categories ──────────────────────────────────────────────────────────────

/**
 * A delegation category groups related rules under a tool.
 *
 * Categories are the unit of composition — blueprints define categories,
 * and defaults provide sensible starting points per domain.
 */
export interface DelegationCategory {
  /** Unique identifier (e.g. "appointment-confirm", "vendor-reply"). */
  readonly id: string;
  /** Human-readable name (e.g. "Appointment Confirmations"). */
  readonly name: string;
  /** Which tool this category applies to (e.g. "email", "calendar"). */
  readonly tool: string;
  /** Rules within this category. */
  readonly rules: readonly DelegationRuleEntry[];
}

// ── Top-Level Container ─────────────────────────────────────────────────────

/**
 * Delegated action rules — the top-level container for blueprint delegation config.
 *
 * Added as an optional `delegation_rules` section in the blueprint schema.
 * Compiled into `workspace/delegated-rules.json` during forge.
 */
export interface DelegatedActionRules {
  /** Delegation categories with their rules. */
  readonly categories: readonly DelegationCategory[];
}

// ── Compiled Output ─────────────────────────────────────────────────────────

/**
 * Compiled delegation rules written to `workspace/delegated-rules.json`.
 *
 * Flat structure optimized for runtime lookup — no intermediate concepts.
 */
export interface CompiledDelegationRules {
  /** Schema version for forward compatibility. */
  readonly version: "1.0";
  /** Timestamp of compilation. */
  readonly generatedAt: string;
  /** Flat list of all delegation categories with resolved rules. */
  readonly categories: readonly DelegationCategory[];
}

/**
 * Match a value against a glob pattern.
 *
 * Supports `*` as a wildcard that matches any substring.
 * Examples:
 * - `matchGlob("email:send:reply", "email:send:*")` → true
 * - `matchGlob("email:send:reply", "email:*")` → true
 * - `matchGlob("calendar:update", "email:*")` → false
 */
export function matchGlob(value: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return value === pattern;

  // Convert glob to regex: escape special chars, replace * with .*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
