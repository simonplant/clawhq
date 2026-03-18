/**
 * Autonomy tuning types.
 *
 * Tracks approval/rejection patterns per action category and generates
 * recommendations for increasing or decreasing agent autonomy.
 */

import type { ApprovalCategory } from "../../operate/approval/types.js";

// --- Context ---

export interface AutonomyContext {
  /** Path to OpenClaw home directory. */
  openclawHome: string;
  /** Path to ClawHQ data directory. */
  clawhqDir: string;
}

// --- Pattern tracking ---

/** Aggregated stats for a single approval category. */
export interface CategoryStats {
  /** The approval category. */
  category: ApprovalCategory;
  /** Total number of resolved approvals (approved + rejected). */
  total: number;
  /** Number of approvals. */
  approved: number;
  /** Number of rejections. */
  rejected: number;
  /** Number of expired entries (informational, not counted in rate). */
  expired: number;
  /** Approval rate as a fraction (0-1). */
  approvalRate: number;
  /** Rejection rate as a fraction (0-1). */
  rejectionRate: number;
}

// --- Recommendations ---

export type RecommendationType = "auto_approve" | "require_approval";

/** A single autonomy recommendation. */
export interface AutonomyRecommendation {
  /** Unique identifier. */
  id: string;
  /** ISO timestamp when this recommendation was generated. */
  createdAt: string;
  /** The category this recommendation covers. */
  category: ApprovalCategory;
  /** What kind of change is recommended. */
  type: RecommendationType;
  /** Human-readable rationale. */
  rationale: string;
  /** The confidence score (0-1) backing this recommendation. */
  confidence: number;
  /** The stats that drove this recommendation. */
  stats: CategoryStats;
  /** Whether the user has acted on this recommendation. */
  status: "pending" | "accepted" | "rejected";
}

// --- Cooldown ---

/** A record of a rejected recommendation, used for cooldown tracking. */
export interface CooldownEntry {
  /** The recommendation ID that was rejected. */
  recommendationId: string;
  /** The category of the rejected recommendation. */
  category: ApprovalCategory;
  /** The type of recommendation that was rejected. */
  type: RecommendationType;
  /** ISO timestamp when the recommendation was rejected. */
  rejectedAt: string;
  /** ISO timestamp when the cooldown expires. */
  cooldownExpiresAt: string;
}

// --- Persistent stores ---

export interface RecommendationStore {
  recommendations: AutonomyRecommendation[];
  cooldowns: CooldownEntry[];
}

// --- Configuration ---

/** Thresholds and configuration for autonomy tuning. */
export interface AutonomyConfig {
  /** Minimum approval rate to suggest auto-approve (0-1). Default: 0.95 */
  autoApproveThreshold: number;
  /** Minimum rejection rate to suggest require-approval (0-1). Default: 0.50 */
  requireApprovalThreshold: number;
  /** Minimum number of resolved approvals before making recommendations. Default: 10 */
  minimumSampleSize: number;
  /** Cooldown period in milliseconds after a rejected recommendation. Default: 7 days */
  cooldownMs: number;
}

/** Default autonomy tuning configuration. */
export const DEFAULT_AUTONOMY_CONFIG: AutonomyConfig = {
  autoApproveThreshold: 0.95,
  requireApprovalThreshold: 0.50,
  minimumSampleSize: 10,
  cooldownMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// --- Audit ---

export type AutonomyAuditEventType =
  | "recommendation_created"
  | "recommendation_accepted"
  | "recommendation_rejected"
  | "autonomy_applied";

export interface AutonomyAuditEntry {
  /** ISO timestamp. */
  timestamp: string;
  /** Type of event. */
  eventType: AutonomyAuditEventType;
  /** Human-readable description. */
  description: string;
  /** Related recommendation ID. */
  relatedId: string;
}

export interface AutonomyAuditLog {
  entries: AutonomyAuditEntry[];
}
