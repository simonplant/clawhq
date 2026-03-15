/**
 * Autonomy analyzer.
 *
 * Takes per-category approval statistics and produces autonomy
 * recommendations based on configurable thresholds:
 *
 * - High approval rate (>= 95%): suggest auto-approve for that category
 * - High rejection rate (>= 50%): suggest require-approval for that category
 *
 * Respects cooldown periods on previously rejected recommendations.
 */

import { randomUUID } from "node:crypto";

import type { ApprovalCategory } from "../../approval/types.js";

import type {
  AutonomyConfig,
  AutonomyRecommendation,
  CategoryStats,
  CooldownEntry,
  RecommendationType,
} from "./types.js";
import { DEFAULT_AUTONOMY_CONFIG } from "./types.js";

/**
 * Check whether a category + recommendation type is in cooldown.
 */
export function isInCooldown(
  category: ApprovalCategory,
  type: RecommendationType,
  cooldowns: CooldownEntry[],
  now: Date = new Date(),
): boolean {
  return cooldowns.some(
    (c) =>
      c.category === category &&
      c.type === type &&
      new Date(c.cooldownExpiresAt).getTime() > now.getTime(),
  );
}

/**
 * Compute a confidence score for a recommendation.
 *
 * Confidence increases with sample size and how far the rate exceeds the threshold.
 * Returns a value between 0 and 1.
 */
export function computeConfidence(
  stats: CategoryStats,
  type: RecommendationType,
  config: AutonomyConfig = DEFAULT_AUTONOMY_CONFIG,
): number {
  const rate = type === "auto_approve" ? stats.approvalRate : stats.rejectionRate;
  const threshold = type === "auto_approve"
    ? config.autoApproveThreshold
    : config.requireApprovalThreshold;

  if (rate < threshold) return 0;

  // How much the rate exceeds the threshold (normalized to the remaining range)
  const rateExcess = (rate - threshold) / (1 - threshold + 0.001);

  // Sample size factor: ramps from 0.5 at minimumSampleSize to 1.0 at 3x minimum
  const sizeFactor = Math.min(1, 0.5 + 0.5 * (stats.total / (config.minimumSampleSize * 3)));

  return Math.min(1, rateExcess * 0.6 + sizeFactor * 0.4);
}

/**
 * Analyze category statistics and generate autonomy recommendations.
 *
 * Only generates recommendations for categories that:
 * 1. Meet the minimum sample size
 * 2. Exceed the relevant threshold
 * 3. Are not in cooldown from a previously rejected recommendation
 */
export function analyzePatterns(
  stats: CategoryStats[],
  cooldowns: CooldownEntry[] = [],
  config: AutonomyConfig = DEFAULT_AUTONOMY_CONFIG,
  now: Date = new Date(),
): AutonomyRecommendation[] {
  const recommendations: AutonomyRecommendation[] = [];

  for (const stat of stats) {
    if (stat.total < config.minimumSampleSize) continue;

    // Check for auto-approve recommendation
    if (stat.approvalRate >= config.autoApproveThreshold) {
      if (!isInCooldown(stat.category, "auto_approve", cooldowns, now)) {
        const confidence = computeConfidence(stat, "auto_approve", config);
        recommendations.push({
          id: `rec-${randomUUID().slice(0, 8)}`,
          createdAt: now.toISOString(),
          category: stat.category,
          type: "auto_approve",
          rationale:
            `Category "${stat.category}" has a ${(stat.approvalRate * 100).toFixed(1)}% approval rate ` +
            `across ${stat.total} decisions. Consider auto-approving actions in this category.`,
          confidence,
          stats: stat,
          status: "pending",
        });
      }
    }

    // Check for require-approval recommendation
    if (stat.rejectionRate >= config.requireApprovalThreshold) {
      if (!isInCooldown(stat.category, "require_approval", cooldowns, now)) {
        const confidence = computeConfidence(stat, "require_approval", config);
        recommendations.push({
          id: `rec-${randomUUID().slice(0, 8)}`,
          createdAt: now.toISOString(),
          category: stat.category,
          type: "require_approval",
          rationale:
            `Category "${stat.category}" has a ${(stat.rejectionRate * 100).toFixed(1)}% rejection rate ` +
            `across ${stat.total} decisions. Consider always requiring approval for this category.`,
          confidence,
          stats: stat,
          status: "pending",
        });
      }
    }
  }

  // Sort by confidence descending
  recommendations.sort((a, b) => b.confidence - a.confidence);

  return recommendations;
}
