/**
 * Post-deploy smoke test runner.
 *
 * Verifies the agent is actually working after deployment:
 * 1. Identity files — confirms agent loads identity files
 * 2. Test message — sends a message and verifies coherent response
 * 3. Integration probe — tests each connected integration with a read-only operation
 *
 * Results are pass/fail per check with actionable diagnostics on failure.
 */

export { checkContainerRunning, checkIdentityFiles, checkTestMessage, checkIntegrations } from "./checks.js";
export type { SmokeCheckResult, SmokeCheckStatus, SmokeTestResult, SmokeTestOptions } from "./types.js";

import { checkContainerRunning, checkIdentityFiles, checkTestMessage, checkIntegrations } from "./checks.js";
import type { SmokeTestOptions, SmokeTestResult, SmokeCheckResult } from "./types.js";

/**
 * Run all smoke test checks and aggregate results.
 * Each check runs independently — one failure doesn't prevent others.
 */
export async function runSmokeTest(opts: SmokeTestOptions): Promise<SmokeTestResult> {
  const checks: SmokeCheckResult[] = [];

  // 1. Container running (fastest, prerequisite for everything else)
  checks.push(await checkContainerRunning(opts));

  // 2. Identity files (no network, checks workspace files)
  checks.push(await checkIdentityFiles(opts));

  // 3. Test message (requires Gateway WebSocket)
  checks.push(await checkTestMessage(opts));

  // 4. Integration probes (requires container exec)
  checks.push(await checkIntegrations(opts));

  const passed = checks.every((c) => c.status === "pass" || c.status === "skip");
  return { passed, checks };
}
