/**
 * Credential health probe runner.
 *
 * Runs all configured probes against values from a .env file
 * and returns a CredReport with status for each provider.
 */

import type { EnvFile } from "../secrets/env.js";
import { getEnvValue, readEnvFile } from "../secrets/env.js";

import { anthropicProbe } from "./anthropic.js";
import { openaiProbe } from "./openai.js";
import { telegramProbe } from "./telegram.js";
import type { CredentialProbe, CredReport, CredResult, CredStatus } from "./types.js";

export type { CredentialProbe, CredReport, CredResult, CredStatus } from "./types.js";
export { anthropicProbe } from "./anthropic.js";
export { openaiProbe } from "./openai.js";
export { telegramProbe } from "./telegram.js";

/** All built-in probes in execution order. */
export const DEFAULT_PROBES: CredentialProbe[] = [
  anthropicProbe,
  openaiProbe,
  telegramProbe,
];

/**
 * Run all credential probes against values from an EnvFile.
 * Skips probes whose env var is not set (reports as "missing").
 */
export async function runProbes(
  env: EnvFile,
  probes: CredentialProbe[] = DEFAULT_PROBES,
): Promise<CredReport> {
  const results: CredResult[] = [];

  for (const probe of probes) {
    const value = getEnvValue(env, probe.envVar);
    if (!value) {
      results.push({
        provider: probe.provider,
        status: "missing",
        message: `${probe.envVar} not configured`,
      });
      continue;
    }

    const result = await probe.check(value);
    results.push(result);
  }

  const counts: Record<CredStatus, number> = {
    valid: 0,
    expired: 0,
    failing: 0,
    error: 0,
    missing: 0,
  };
  for (const r of results) {
    counts[r.status]++;
  }

  return { results, counts };
}

/**
 * Run probes by reading .env from a file path.
 */
export async function runProbesFromFile(
  envPath: string,
  probes?: CredentialProbe[],
): Promise<CredReport> {
  const env = await readEnvFile(envPath);
  return runProbes(env, probes);
}

/**
 * Format a CredReport as a human-readable status table.
 */
export function formatCredTable(report: CredReport): string {
  const lines: string[] = [];

  const providerWidth = Math.max(
    8,
    ...report.results.map((r) => r.provider.length),
  );
  const statusWidth = 7;

  lines.push(
    `${"PROVIDER".padEnd(providerWidth)}  ${"STATUS".padEnd(statusWidth)}  MESSAGE`,
  );
  lines.push("-".repeat(providerWidth + statusWidth + providerWidth + 10));

  const STATUS_LABELS: Record<CredStatus, string> = {
    valid: "VALID",
    expired: "EXPRD",
    failing: "FAIL",
    error: "ERROR",
    missing: "SKIP",
  };

  for (const r of report.results) {
    const label = STATUS_LABELS[r.status];
    lines.push(
      `${r.provider.padEnd(providerWidth)}  ${label.padEnd(statusWidth)}  ${r.message}`,
    );
  }

  lines.push("");
  const configured = report.results.length - report.counts.missing;
  lines.push(
    `${report.counts.valid} valid, ${report.counts.failing + report.counts.expired} failing, ${report.counts.error} errors, ${report.counts.missing} skipped (${configured} configured)`,
  );

  return lines.join("\n");
}
