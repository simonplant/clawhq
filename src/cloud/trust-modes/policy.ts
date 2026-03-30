/**
 * Command classification policy by trust mode.
 *
 * Determines what each trust mode allows, blocks, or requires approval for.
 * Content-access commands are architecturally blocked in ALL modes (AD-05).
 */

import type { TrustMode } from "../../config/types.js";
import type { CloudCommandType, CommandDisposition } from "../types.js";

// ── Architecturally Blocked Commands (AD-05) ─────────────────────────────────

/**
 * Commands that are BLOCKED in every mode — no code path exists.
 * These are not policy-blocked; the agentd daemon has no handler for them.
 */
const ARCHITECTURALLY_BLOCKED: ReadonlySet<CloudCommandType> = new Set([
  "read-memory-contents",
  "read-conversations",
  "read-credential-values",
  "read-identity-files",
  "shell-access",
]);

// ── Policy Table ─────────────────────────────────────────────────────────────

/**
 * Command disposition by trust mode.
 *
 * Maps directly to the table in ARCHITECTURE.md (lines 439-454).
 */
const POLICY_TABLE: Record<CloudCommandType, Record<TrustMode, CommandDisposition>> = {
  "health-check":             { paranoid: "blocked",  "zero-trust": "allowed",  managed: "allowed" },
  "update-notify":            { paranoid: "blocked",  "zero-trust": "allowed",  managed: "allowed" },
  "security-advisory":        { paranoid: "blocked",  "zero-trust": "allowed",  managed: "allowed" },
  "sentinel-alert":           { paranoid: "blocked",  "zero-trust": "allowed",  managed: "allowed" },
  "trigger-update":           { paranoid: "blocked",  "zero-trust": "approval", managed: "auto" },
  "trigger-backup":           { paranoid: "blocked",  "zero-trust": "approval", managed: "auto" },
  "restart-agent":            { paranoid: "blocked",  "zero-trust": "approval", managed: "auto" },
  "apply-config-patch":       { paranoid: "blocked",  "zero-trust": "approval", managed: "approval" },
  "read-health-status":       { paranoid: "blocked",  "zero-trust": "allowed",  managed: "allowed" },
  "read-operational-metrics": { paranoid: "blocked",  "zero-trust": "blocked",  managed: "allowed" },
  // Architecturally blocked — no handler (AD-05)
  "read-memory-contents":     { paranoid: "blocked",  "zero-trust": "blocked",  managed: "blocked" },
  "read-conversations":       { paranoid: "blocked",  "zero-trust": "blocked",  managed: "blocked" },
  "read-credential-values":   { paranoid: "blocked",  "zero-trust": "blocked",  managed: "blocked" },
  "read-identity-files":      { paranoid: "blocked",  "zero-trust": "blocked",  managed: "blocked" },
  "shell-access":             { paranoid: "blocked",  "zero-trust": "blocked",  managed: "blocked" },
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check if a command type is architecturally blocked (no handler exists).
 */
export function isArchitecturallyBlocked(commandType: CloudCommandType): boolean {
  return ARCHITECTURALLY_BLOCKED.has(commandType);
}

/**
 * Get the disposition of a command type in a given trust mode.
 */
export function getCommandDisposition(
  commandType: CloudCommandType,
  mode: TrustMode,
): CommandDisposition {
  const entry = POLICY_TABLE[commandType];
  if (!entry) return "blocked";
  return entry[mode];
}

/**
 * Check if a command type is supported (has a policy entry and is not
 * architecturally blocked).
 */
export function isCommandSupported(commandType: CloudCommandType): boolean {
  return commandType in POLICY_TABLE && !ARCHITECTURALLY_BLOCKED.has(commandType);
}

/**
 * Get all allowed command types for a given trust mode.
 */
export function getAllowedCommands(mode: TrustMode): readonly CloudCommandType[] {
  return (Object.keys(POLICY_TABLE) as CloudCommandType[]).filter(
    (cmd) => POLICY_TABLE[cmd][mode] !== "blocked",
  );
}
