/**
 * Check: Memory lifecycle health — tier sizes, transitions, and staleness.
 * Reports warnings for budget overruns, pending transitions, and stale entries.
 */

import { collectMemoryHealth } from "../../internal/memory/index.js";
import type { Check, CheckResult, DoctorContext } from "../types.js";

export const memoryHealthCheck: Check = {
  name: "Memory health",

  async run(ctx: DoctorContext): Promise<CheckResult> {
    const report = await collectMemoryHealth(ctx.openclawHome);
    const issues: string[] = [];
    const fixes: string[] = [];

    if (report.totalEntries === 0) {
      return {
        name: this.name,
        status: "pass",
        message: "No structured memory entries found — nothing to check",
        fix: "",
      };
    }

    if (report.hotTierOverBudget) {
      const hotTier = report.tiers.find((t) => t.name === "hot");
      const sizeKB = hotTier ? Math.round(hotTier.sizeBytes / 1024) : 0;
      issues.push(`Hot tier over budget (${sizeKB}KB > 100KB)`);
      fixes.push("Run tier transitions to move old entries to warm tier");
    }

    if (report.pendingTransitions > 0) {
      issues.push(`${report.pendingTransitions} entries pending tier transition`);
      fixes.push("Run memory tier transitions to maintain healthy lifecycle");
    }

    if (report.staleEntriesCount > 0) {
      issues.push(`${report.staleEntriesCount} stale entries (not accessed in 30+ days)`);
      fixes.push("Review stale memory entries for relevance");
    }

    if (issues.length === 0) {
      const tierSummary = report.tiers
        .map((t) => `${t.name}:${t.entryCount}`)
        .join(", ");
      return {
        name: this.name,
        status: "pass",
        message: `Memory healthy — ${report.totalEntries} entries (${tierSummary})`,
        fix: "",
      };
    }

    return {
      name: this.name,
      status: "warn",
      message: issues.join("; "),
      fix: fixes.join("; "),
    };
  },
};
