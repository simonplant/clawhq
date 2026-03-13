/**
 * Auto-fix for safe issues detected by doctor checks.
 *
 * Only fixes issues that are safe to auto-remediate:
 * - File permissions (.env, identity files)
 */

import { DEFAULT_CHECKS } from "./runner.js";
import type { Check, DoctorContext, FixResult } from "./types.js";
import { isFixable } from "./types.js";

export async function runFixes(
  ctx: DoctorContext,
  checks: Check[] = DEFAULT_CHECKS,
): Promise<FixResult[]> {
  const results: FixResult[] = [];

  for (const check of checks) {
    if (!isFixable(check)) continue;

    try {
      const result = await check.fix(ctx);
      results.push(result);
    } catch (err: unknown) {
      results.push({
        name: check.name,
        fixed: false,
        message: `Fix threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return results;
}
