/**
 * Autonomy recommender.
 *
 * Orchestrates the full recommendation pipeline:
 * 1. Load approval history and compute stats (tracker)
 * 2. Load existing recommendations and cooldowns (store)
 * 3. Analyze patterns and generate new recommendations (analyzer)
 * 4. Persist recommendations and handle accept/reject with cooldown
 * 5. Log all changes to the audit trail
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ApprovalQueueOptions } from "../../operate/approval/types.js";

import { analyzePatterns } from "./analyzer.js";
import { trackPatterns } from "./tracker.js";
import type {
  AutonomyAuditEntry,
  AutonomyAuditLog,
  AutonomyConfig,
  AutonomyContext,
  AutonomyRecommendation,
  CooldownEntry,
  RecommendationStore,
} from "./types.js";
import { DEFAULT_AUTONOMY_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const STORE_FILE = "autonomy-recommendations.json";
const AUDIT_FILE = "autonomy-audit.json";

function storePath(ctx: AutonomyContext): string {
  return join(ctx.clawhqDir, "autonomy", STORE_FILE);
}

function auditPath(ctx: AutonomyContext): string {
  return join(ctx.clawhqDir, "autonomy", AUDIT_FILE);
}

async function ensureDir(ctx: AutonomyContext): Promise<void> {
  await mkdir(join(ctx.clawhqDir, "autonomy"), { recursive: true });
}

// ---------------------------------------------------------------------------
// Store persistence
// ---------------------------------------------------------------------------

/** Load recommendation store from disk. */
export async function loadStore(ctx: AutonomyContext): Promise<RecommendationStore> {
  try {
    const content = await readFile(storePath(ctx), "utf-8");
    return JSON.parse(content) as RecommendationStore;
  } catch {
    return { recommendations: [], cooldowns: [] };
  }
}

/** Save recommendation store to disk. */
export async function saveStore(
  ctx: AutonomyContext,
  store: RecommendationStore,
): Promise<void> {
  await ensureDir(ctx);
  await writeFile(
    storePath(ctx),
    JSON.stringify(store, null, 2) + "\n",
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

/** Load the autonomy audit log. */
export async function loadAuditLog(ctx: AutonomyContext): Promise<AutonomyAuditLog> {
  try {
    const content = await readFile(auditPath(ctx), "utf-8");
    return JSON.parse(content) as AutonomyAuditLog;
  } catch {
    return { entries: [] };
  }
}

async function saveAuditLog(
  ctx: AutonomyContext,
  log: AutonomyAuditLog,
): Promise<void> {
  await ensureDir(ctx);
  await writeFile(
    auditPath(ctx),
    JSON.stringify(log, null, 2) + "\n",
    "utf-8",
  );
}

/** Append an audit entry. */
export async function logAuditEvent(
  ctx: AutonomyContext,
  eventType: AutonomyAuditEntry["eventType"],
  description: string,
  relatedId: string,
): Promise<AutonomyAuditEntry> {
  const entry: AutonomyAuditEntry = {
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

// ---------------------------------------------------------------------------
// Recommendation pipeline
// ---------------------------------------------------------------------------

export interface GenerateResult {
  /** Newly generated recommendations. */
  recommendations: AutonomyRecommendation[];
  /** All existing pending recommendations (including newly generated). */
  allPending: AutonomyRecommendation[];
}

/**
 * Run the full recommendation pipeline:
 * 1. Track approval patterns
 * 2. Filter by cooldowns and existing pending recommendations
 * 3. Generate new recommendations
 * 4. Persist and audit-log
 */
export async function generateRecommendations(
  ctx: AutonomyContext,
  config: AutonomyConfig = DEFAULT_AUTONOMY_CONFIG,
  queueOptions: ApprovalQueueOptions = {},
): Promise<GenerateResult> {
  // Track patterns from approval history
  const stats = await trackPatterns({
    ...queueOptions,
    openclawHome: ctx.openclawHome,
  });

  // Load existing store
  const store = await loadStore(ctx);

  // Prune expired cooldowns
  const now = new Date();
  store.cooldowns = store.cooldowns.filter(
    (c) => new Date(c.cooldownExpiresAt).getTime() > now.getTime(),
  );

  // Don't re-recommend for categories that already have pending recommendations
  const pendingCategories = new Set(
    store.recommendations
      .filter((r) => r.status === "pending")
      .map((r) => `${r.category}:${r.type}`),
  );

  // Generate new recommendations
  const newRecs = analyzePatterns(stats, store.cooldowns, config, now).filter(
    (r) => !pendingCategories.has(`${r.category}:${r.type}`),
  );

  // Add new recommendations to store
  for (const rec of newRecs) {
    store.recommendations.push(rec);
  }

  await saveStore(ctx, store);

  // Audit log new recommendations
  for (const rec of newRecs) {
    await logAuditEvent(
      ctx,
      "recommendation_created",
      `Generated ${rec.type} recommendation for "${rec.category}" ` +
        `(confidence: ${(rec.confidence * 100).toFixed(1)}%, ` +
        `${rec.stats.total} decisions)`,
      rec.id,
    );
  }

  const allPending = store.recommendations.filter((r) => r.status === "pending");

  return { recommendations: newRecs, allPending };
}

// ---------------------------------------------------------------------------
// Accept / Reject
// ---------------------------------------------------------------------------

export interface AcceptResult {
  recommendation: AutonomyRecommendation;
  message: string;
}

/**
 * Accept a recommendation. Marks it as accepted and logs the event.
 * The caller is responsible for applying the actual policy change.
 */
export async function acceptRecommendation(
  ctx: AutonomyContext,
  recommendationId: string,
): Promise<AcceptResult> {
  const store = await loadStore(ctx);
  const rec = store.recommendations.find((r) => r.id === recommendationId);

  if (!rec) {
    throw new AutonomyError(
      `Recommendation "${recommendationId}" not found.`,
      "NOT_FOUND",
    );
  }

  if (rec.status !== "pending") {
    throw new AutonomyError(
      `Recommendation "${recommendationId}" is already ${rec.status}.`,
      "ALREADY_RESOLVED",
    );
  }

  rec.status = "accepted";
  await saveStore(ctx, store);

  await logAuditEvent(
    ctx,
    "recommendation_accepted",
    `Accepted ${rec.type} recommendation for "${rec.category}"`,
    rec.id,
  );

  const actionLabel = rec.type === "auto_approve"
    ? `auto-approve actions in "${rec.category}"`
    : `always require approval for "${rec.category}"`;

  return {
    recommendation: rec,
    message: `Accepted: ${actionLabel}`,
  };
}

export interface RejectResult {
  recommendation: AutonomyRecommendation;
  cooldown: CooldownEntry;
  message: string;
}

/**
 * Reject a recommendation. Adds a cooldown so the same recommendation
 * type for the same category is not regenerated until the cooldown expires.
 */
export async function rejectRecommendation(
  ctx: AutonomyContext,
  recommendationId: string,
  config: AutonomyConfig = DEFAULT_AUTONOMY_CONFIG,
): Promise<RejectResult> {
  const store = await loadStore(ctx);
  const rec = store.recommendations.find((r) => r.id === recommendationId);

  if (!rec) {
    throw new AutonomyError(
      `Recommendation "${recommendationId}" not found.`,
      "NOT_FOUND",
    );
  }

  if (rec.status !== "pending") {
    throw new AutonomyError(
      `Recommendation "${recommendationId}" is already ${rec.status}.`,
      "ALREADY_RESOLVED",
    );
  }

  rec.status = "rejected";

  const now = new Date();
  const cooldown: CooldownEntry = {
    recommendationId: rec.id,
    category: rec.category,
    type: rec.type,
    rejectedAt: now.toISOString(),
    cooldownExpiresAt: new Date(now.getTime() + config.cooldownMs).toISOString(),
  };

  store.cooldowns.push(cooldown);
  await saveStore(ctx, store);

  await logAuditEvent(
    ctx,
    "recommendation_rejected",
    `Rejected ${rec.type} recommendation for "${rec.category}" ` +
      `(cooldown until ${cooldown.cooldownExpiresAt.slice(0, 19).replace("T", " ")})`,
    rec.id,
  );

  const cooldownDays = Math.round(config.cooldownMs / (24 * 60 * 60 * 1000));

  return {
    recommendation: rec,
    cooldown,
    message: `Rejected. Will not re-recommend ${rec.type} for "${rec.category}" for ${cooldownDays} days.`,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format recommendations for CLI display.
 */
export function formatRecommendations(
  recommendations: AutonomyRecommendation[],
): string {
  if (recommendations.length === 0) {
    return "No autonomy recommendations at this time.";
  }

  const lines: string[] = [];
  lines.push(
    `Autonomy Recommendations — ${recommendations.length} suggestion${recommendations.length !== 1 ? "s" : ""}`,
  );
  lines.push("=".repeat(60));

  for (const rec of recommendations) {
    lines.push("");
    lines.push(`  ID:         ${rec.id}`);
    lines.push(`  Category:   ${rec.category}`);
    lines.push(
      `  Action:     ${rec.type === "auto_approve" ? "Auto-approve" : "Require approval"}`,
    );
    lines.push(`  Confidence: ${(rec.confidence * 100).toFixed(1)}%`);
    lines.push(
      `  Stats:      ${rec.stats.approved} approved, ${rec.stats.rejected} rejected (${rec.stats.total} total)`,
    );
    lines.push(`  Rationale:  ${rec.rationale}`);
    lines.push(`  Status:     ${rec.status}`);
    lines.push("  " + "-".repeat(56));
  }

  return lines.join("\n");
}

/**
 * Format a dry-run preview showing what would change.
 */
export function formatDryRun(
  recommendations: AutonomyRecommendation[],
): string {
  if (recommendations.length === 0) {
    return "No changes would be made — no recommendations meet the current thresholds.";
  }

  const lines: string[] = [];
  lines.push("Dry Run — Proposed Autonomy Changes");
  lines.push("=".repeat(60));
  lines.push("");
  lines.push("The following changes would be recommended if applied:");
  lines.push("");

  for (const rec of recommendations) {
    const action = rec.type === "auto_approve"
      ? "WOULD AUTO-APPROVE"
      : "WOULD REQUIRE APPROVAL";

    lines.push(
      `  [${action}] ${rec.category} ` +
        `(${(rec.confidence * 100).toFixed(1)}% confidence, ` +
        `${rec.stats.approved}/${rec.stats.total} approved)`,
    );
  }

  lines.push("");
  lines.push("Run without --dry-run to generate and store these recommendations.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class AutonomyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AutonomyError";
  }
}
