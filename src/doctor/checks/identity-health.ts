/**
 * Check: Identity governance — token budget, staleness, and consistency.
 * Reports warnings for budget thresholds and stale/contradictory identity files.
 */

import { checkBudget, checkConsistency, checkStaleness } from "../../identity/index.js";
import type { Check, CheckResult, DoctorContext } from "../types.js";

export const identityHealthCheck: Check = {
  name: "Identity health",

  async run(ctx: DoctorContext): Promise<CheckResult> {
    const identityCtx = { openclawHome: ctx.openclawHome };
    const issues: string[] = [];
    const fixes: string[] = [];

    // Budget check
    try {
      const budget = await checkBudget(identityCtx);
      if (budget.files.length === 0) {
        return {
          name: this.name,
          status: "pass",
          message: "No identity files found — nothing to check",
          fix: "",
        };
      }

      if (budget.threshold === "critical") {
        issues.push(
          `Token budget at ${budget.budgetPercent.toFixed(0)}% (${budget.totalTokens}/${budget.budgetLimit})`,
        );
        fixes.push("Trim identity files to stay under 90% of bootstrapMaxChars budget");
      } else if (budget.threshold === "warning") {
        issues.push(
          `Token budget at ${budget.budgetPercent.toFixed(0)}% (${budget.totalTokens}/${budget.budgetLimit})`,
        );
        fixes.push("Monitor identity file growth — approaching 70% budget threshold");
      }
    } catch (err: unknown) {
      issues.push(`Budget check failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Staleness check
    try {
      const staleness = await checkStaleness(identityCtx);
      if (staleness.staleCount > 0) {
        const staleFiles = staleness.entries
          .filter((e) => e.stale)
          .map((e) => e.filename)
          .join(", ");
        issues.push(`${staleness.staleCount} stale file(s): ${staleFiles}`);
        fixes.push("Run `clawhq evolve --identity` to review stale identity files");
      }
    } catch (err: unknown) {
      issues.push(`Staleness check failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Consistency check
    try {
      const consistency = await checkConsistency(identityCtx);
      if (consistency.contradictions.length > 0) {
        issues.push(`${consistency.contradictions.length} potential contradiction(s) found`);
        fixes.push("Run `clawhq evolve --identity` to review contradictions");
      }
    } catch (err: unknown) {
      issues.push(`Consistency check failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (issues.length === 0) {
      return {
        name: this.name,
        status: "pass",
        message: "Identity files are within budget, fresh, and consistent",
        fix: "",
      };
    }

    // Determine overall status: budget critical or contradictions = warn, not fail
    // Identity health is advisory, not blocking
    return {
      name: this.name,
      status: "warn",
      message: issues.join("; "),
      fix: fixes.join("; "),
    };
  },
};
