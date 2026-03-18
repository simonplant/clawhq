/**
 * Evolve history — change tracking and rollback for all Evolve actions.
 *
 * Every Evolve action (skill install/update/remove, tool install/remove,
 * integration add/remove/swap, provider add/remove, identity update)
 * records an EvolveChange entry with a rollback snapshot reference.
 * Rollback snapshots expire after 30 days.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvolveChangeType =
  | "skill_install"
  | "skill_update"
  | "skill_remove"
  | "tool_install"
  | "tool_remove"
  | "integration_add"
  | "integration_remove"
  | "integration_swap"
  | "provider_add"
  | "provider_remove"
  | "identity_update";

export interface EvolveChange {
  /** Unique change identifier, e.g. "evolve-1710000000000". */
  id: string;
  /** ISO timestamp of when the change was applied. */
  timestamp: string;
  /** What kind of Evolve action was performed. */
  changeType: EvolveChangeType;
  /** Human-readable target of the change (e.g. skill name, tool name, category). */
  target: string;
  /** Summary of the state before the change. */
  previousState: string;
  /** Summary of the state after the change. */
  newState: string;
  /**
   * Snapshot ID for rollback (e.g. skill snapshot ID, or an inline
   * JSON blob for tool/integration changes that have no file-based snapshot).
   */
  rollbackSnapshotId: string | null;
  /** ISO timestamp when the rollback snapshot expires. */
  rollbackExpiresAt: string | null;
  /** Whether rollback requires a container image rebuild. */
  requiresRebuild: boolean;
  /** Source URI for skill/tool installs (for audit trail). */
  sourceUri?: string;
  /** Vetting summary from the supply chain security pipeline. */
  vettingSummary?: string;
}

export interface EvolveHistory {
  changes: EvolveChange[];
}

export interface EvolveContext {
  openclawHome: string;
  clawhqDir: string;
}

export class EvolveError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "EvolveError";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORY_FILE = "evolve-history.json";
const ROLLBACK_DAYS = 30;

// ---------------------------------------------------------------------------
// Registry persistence
// ---------------------------------------------------------------------------

function historyPath(ctx: EvolveContext): string {
  return join(ctx.clawhqDir, HISTORY_FILE);
}

export async function loadHistory(ctx: EvolveContext): Promise<EvolveHistory> {
  try {
    const content = await readFile(historyPath(ctx), "utf-8");
    return JSON.parse(content) as EvolveHistory;
  } catch {
    return { changes: [] };
  }
}

export async function saveHistory(
  ctx: EvolveContext,
  history: EvolveHistory,
): Promise<void> {
  await mkdir(ctx.clawhqDir, { recursive: true });
  await writeFile(
    historyPath(ctx),
    JSON.stringify(history, null, 2) + "\n",
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Record a change
// ---------------------------------------------------------------------------

/**
 * Record an Evolve change in the history. Called by each Evolve action
 * after it completes successfully.
 */
export async function recordChange(
  ctx: EvolveContext,
  params: {
    changeType: EvolveChangeType;
    target: string;
    previousState: string;
    newState: string;
    rollbackSnapshotId: string | null;
    requiresRebuild: boolean;
    sourceUri?: string;
    vettingSummary?: string;
  },
): Promise<EvolveChange> {
  const now = new Date();
  const expires = params.rollbackSnapshotId
    ? new Date(now.getTime() + ROLLBACK_DAYS * 24 * 60 * 60 * 1000)
    : null;

  const change: EvolveChange = {
    id: `evolve-${now.getTime()}`,
    timestamp: now.toISOString(),
    changeType: params.changeType,
    target: params.target,
    previousState: params.previousState,
    newState: params.newState,
    rollbackSnapshotId: params.rollbackSnapshotId,
    rollbackExpiresAt: expires ? expires.toISOString() : null,
    requiresRebuild: params.requiresRebuild,
    ...(params.sourceUri ? { sourceUri: params.sourceUri } : {}),
    ...(params.vettingSummary ? { vettingSummary: params.vettingSummary } : {}),
  };

  const history = await loadHistory(ctx);
  history.changes.push(change);
  await saveHistory(ctx, history);

  return change;
}

// ---------------------------------------------------------------------------
// History query
// ---------------------------------------------------------------------------

export type RollbackStatus = "available" | "expired" | "unavailable";

export interface HistoryEntry extends EvolveChange {
  rollbackStatus: RollbackStatus;
}

/**
 * Get the full evolve history with rollback availability computed.
 * Returns entries in reverse chronological order (newest first).
 */
export function getHistory(history: EvolveHistory): HistoryEntry[] {
  const now = new Date();

  return history.changes
    .map((change) => ({
      ...change,
      rollbackStatus: computeRollbackStatus(change, now),
    }))
    .reverse();
}

function computeRollbackStatus(change: EvolveChange, now: Date): RollbackStatus {
  if (!change.rollbackSnapshotId) {
    return "unavailable";
  }
  if (!change.rollbackExpiresAt) {
    return "unavailable";
  }
  if (new Date(change.rollbackExpiresAt) < now) {
    return "expired";
  }
  return "available";
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export interface RollbackResult {
  change: EvolveChange;
  requiresRebuild: boolean;
}

/**
 * Roll back a specific Evolve change by its ID.
 *
 * Delegates to the appropriate domain-specific rollback:
 * - skill_*: uses skill snapshot rollback
 * - tool_*: reverses tool registry change
 * - integration_*: reverses integration registry change
 *
 * After rollback, records a new "inverse" change in history.
 */
export async function rollbackChange(
  ctx: EvolveContext,
  changeId: string,
): Promise<RollbackResult> {
  const history = await loadHistory(ctx);
  const change = history.changes.find((c) => c.id === changeId);

  if (!change) {
    throw new EvolveError(
      `Change "${changeId}" not found in evolve history.`,
      "CHANGE_NOT_FOUND",
    );
  }

  const status = computeRollbackStatus(change, new Date());
  if (status === "unavailable") {
    throw new EvolveError(
      `Change "${changeId}" has no rollback snapshot.`,
      "NO_SNAPSHOT",
    );
  }
  if (status === "expired") {
    throw new EvolveError(
      `Rollback for "${changeId}" has expired (expired ${change.rollbackExpiresAt}).`,
      "SNAPSHOT_EXPIRED",
    );
  }

  let requiresRebuild: boolean;

  switch (change.changeType) {
    case "skill_install":
    case "skill_update":
    case "skill_remove":
      requiresRebuild = await rollbackSkillChange(ctx, change);
      break;

    case "tool_install":
    case "tool_remove":
      requiresRebuild = await rollbackToolChange(ctx, change);
      break;

    case "integration_add":
    case "integration_remove":
    case "integration_swap":
      requiresRebuild = await rollbackIntegrationChange(ctx, change);
      break;

    case "provider_add":
    case "provider_remove":
      requiresRebuild = await rollbackProviderChange(ctx, change);
      break;

    case "identity_update":
      requiresRebuild = await rollbackIdentityChange(ctx, change);
      break;

    default:
      throw new EvolveError(
        `Unknown change type: ${change.changeType}`,
        "UNKNOWN_TYPE",
      );
  }

  // Record the rollback as a new change
  await recordChange(ctx, {
    changeType: change.changeType,
    target: change.target,
    previousState: change.newState,
    newState: `rolled back to: ${change.previousState}`,
    rollbackSnapshotId: null,
    requiresRebuild,
  });

  return { change, requiresRebuild };
}

// ---------------------------------------------------------------------------
// Domain-specific rollback implementations
// ---------------------------------------------------------------------------

async function rollbackSkillChange(
  ctx: EvolveContext,
  change: EvolveChange,
): Promise<boolean> {
  const { rollbackSkill } = await import("./skills/lifecycle.js");

  if (!change.rollbackSnapshotId) {
    throw new EvolveError("No snapshot for skill rollback.", "NO_SNAPSHOT");
  }

  const skillCtx = { openclawHome: ctx.openclawHome, clawhqDir: ctx.clawhqDir };
  const restored = await rollbackSkill(skillCtx, change.rollbackSnapshotId);
  return restored.requiresContainerDeps;
}

async function rollbackToolChange(
  ctx: EvolveContext,
  change: EvolveChange,
): Promise<boolean> {
  const { installTool, removeToolOp } = await import("./tools/tool.js");

  const toolCtx = { openclawHome: ctx.openclawHome, clawhqDir: ctx.clawhqDir };

  if (change.changeType === "tool_install") {
    // Reverse an install by removing the tool
    await removeToolOp(toolCtx, change.target);
  } else {
    // Reverse a remove by re-installing
    await installTool(toolCtx, change.target);
  }

  return true; // Tool changes always require rebuild
}

async function rollbackIntegrationChange(
  ctx: EvolveContext,
  change: EvolveChange,
): Promise<boolean> {
  // Integration rollback restores the previous registry state from the snapshot.
  // The snapshot stores the serialized previous integration entry.
  if (!change.rollbackSnapshotId) {
    throw new EvolveError("No snapshot for integration rollback.", "NO_SNAPSHOT");
  }

  const {
    loadRegistry,
    saveRegistry,
  } = await import("./integrate/lifecycle.js");

  const intCtx = { openclawHome: ctx.openclawHome, clawhqDir: ctx.clawhqDir };

  // The rollbackSnapshotId stores the serialized previous state
  const previousState = JSON.parse(change.rollbackSnapshotId) as {
    action: string;
    integration?: { category: string; provider: string; envVar: string; addedAt: string; lastCheckedAt: string | null };
  };

  const registry = await loadRegistry(intCtx);

  if (change.changeType === "integration_add") {
    // Reverse add: remove the integration
    const idx = registry.integrations.findIndex(
      (i) => i.category === change.target,
    );
    if (idx !== -1) {
      registry.integrations.splice(idx, 1);
    }
  } else if (change.changeType === "integration_remove") {
    // Reverse remove: restore the integration
    if (previousState.integration) {
      registry.integrations.push(previousState.integration);
    }
  } else if (change.changeType === "integration_swap") {
    // Reverse swap: restore old provider
    if (previousState.integration) {
      const idx = registry.integrations.findIndex(
        (i) => i.category === change.target,
      );
      if (idx !== -1) {
        registry.integrations[idx] = previousState.integration;
      } else {
        registry.integrations.push(previousState.integration);
      }
    }
  }

  await saveRegistry(intCtx, registry);
  return false;
}

async function rollbackProviderChange(
  ctx: EvolveContext,
  change: EvolveChange,
): Promise<boolean> {
  if (!change.rollbackSnapshotId) {
    throw new EvolveError("No snapshot for provider rollback.", "NO_SNAPSHOT");
  }

  const {
    loadRegistry,
    saveRegistry,
  } = await import("../design/provider/provider.js");

  const previousState = JSON.parse(change.rollbackSnapshotId) as {
    action: string;
    provider?: {
      id: string;
      label: string;
      category: string;
      envVar: string;
      domains: string[];
      status: string;
      addedAt: string;
    };
  };

  const registry = await loadRegistry(ctx.openclawHome);

  if (change.changeType === "provider_add") {
    // Reverse add: remove the provider
    const idx = registry.providers.findIndex((p) => p.id === change.target);
    if (idx !== -1) {
      registry.providers.splice(idx, 1);
    }
  } else if (change.changeType === "provider_remove") {
    // Reverse remove: restore the provider
    if (previousState.provider) {
      registry.providers.push(previousState.provider as import("../design/provider/types.js").ProviderConfig);
    }
  }

  await saveRegistry(ctx.openclawHome, registry);
  return false;
}

async function rollbackIdentityChange(
  ctx: EvolveContext,
  change: EvolveChange,
): Promise<boolean> {
  if (!change.rollbackSnapshotId) {
    throw new EvolveError("No snapshot for identity rollback.", "NO_SNAPSHOT");
  }

  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  // The snapshot stores the previous file content and path
  const previousState = JSON.parse(change.rollbackSnapshotId) as {
    filePath: string;
    content: string;
  };

  const fullPath = join(ctx.openclawHome, previousState.filePath);
  await writeFile(fullPath, previousState.content, "utf-8");

  return false;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const CHANGE_TYPE_LABELS: Record<EvolveChangeType, string> = {
  skill_install: "Skill Install",
  skill_update: "Skill Update",
  skill_remove: "Skill Remove",
  tool_install: "Tool Install",
  tool_remove: "Tool Remove",
  integration_add: "Integration Add",
  integration_remove: "Integration Remove",
  integration_swap: "Integration Swap",
  provider_add: "Provider Add",
  provider_remove: "Provider Remove",
  identity_update: "Identity Update",
};

const ROLLBACK_STATUS_LABELS: Record<RollbackStatus, string> = {
  available: "AVAILABLE",
  expired: "EXPIRED",
  unavailable: "—",
};

/**
 * Format evolve audit — detailed view with sources, timestamps,
 * vetting results, and rollback status.
 */
export function formatAudit(entries: HistoryEntry[]): string {
  if (entries.length === 0) {
    return "No evolve changes recorded yet.";
  }

  const lines: string[] = [];
  lines.push(`Evolve Audit — ${entries.length} change${entries.length !== 1 ? "s" : ""} recorded`);
  lines.push("=".repeat(60));

  for (const entry of entries) {
    lines.push("");
    lines.push(`  ID:        ${entry.id}`);
    lines.push(`  Type:      ${CHANGE_TYPE_LABELS[entry.changeType]}`);
    lines.push(`  Target:    ${entry.target}`);
    lines.push(`  Timestamp: ${entry.timestamp.slice(0, 19).replace("T", " ")}`);
    if (entry.sourceUri) {
      lines.push(`  Source:    ${entry.sourceUri}`);
    }
    lines.push(`  Before:    ${entry.previousState}`);
    lines.push(`  After:     ${entry.newState}`);
    if (entry.vettingSummary) {
      lines.push(`  Vetting:   ${entry.vettingSummary}`);
    }
    lines.push(`  Rollback:  ${ROLLBACK_STATUS_LABELS[entry.rollbackStatus]}`);
    if (entry.rollbackExpiresAt && entry.rollbackStatus === "available") {
      lines.push(`  Expires:   ${entry.rollbackExpiresAt.slice(0, 19).replace("T", " ")}`);
    }
    lines.push(`  Rebuild:   ${entry.requiresRebuild ? "required" : "not required"}`);
    lines.push("  " + "-".repeat(56));
  }

  return lines.join("\n");
}

/**
 * Format evolve history for CLI display.
 */
export function formatHistory(entries: HistoryEntry[]): string {
  if (entries.length === 0) {
    return "No evolve changes recorded yet.";
  }

  const lines: string[] = [];
  const idWidth = Math.max(2, ...entries.map((e) => e.id.length));
  const typeWidth = Math.max(4, ...entries.map((e) => CHANGE_TYPE_LABELS[e.changeType].length));
  const targetWidth = Math.max(6, ...entries.map((e) => e.target.length));

  lines.push(
    `${"ID".padEnd(idWidth)}  ${"TYPE".padEnd(typeWidth)}  ${"TARGET".padEnd(targetWidth)}  ${"ROLLBACK".padEnd(11)}  TIMESTAMP`,
  );
  lines.push("-".repeat(idWidth + typeWidth + targetWidth + 30));

  for (const entry of entries) {
    const date = entry.timestamp.slice(0, 19).replace("T", " ");
    const rollback = ROLLBACK_STATUS_LABELS[entry.rollbackStatus];
    lines.push(
      `${entry.id.padEnd(idWidth)}  ${CHANGE_TYPE_LABELS[entry.changeType].padEnd(typeWidth)}  ${entry.target.padEnd(targetWidth)}  ${rollback.padEnd(11)}  ${date}`,
    );
  }

  return lines.join("\n");
}
