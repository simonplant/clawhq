/**
 * Integration health collector.
 *
 * Reuses credential probes from the security module to check
 * each configured integration's health status.
 */

import { runProbesFromFile } from "../security/credentials/index.js";

import type { IntegrationHealth, IntegrationSection, IntegrationStatus } from "./types.js";

/**
 * Collect integration health by running credential probes.
 */
export async function collectIntegrationHealth(options: {
  envPath?: string;
} = {}): Promise<IntegrationSection> {
  const envPath = options.envPath ?? "~/.openclaw/.env";
  const resolved = envPath.replace(/^~/, process.env.HOME ?? "~");

  const integrations: IntegrationHealth[] = [];
  const counts: Record<IntegrationStatus, number> = {
    valid: 0,
    expired: 0,
    failing: 0,
    error: 0,
    missing: 0,
  };

  try {
    const report = await runProbesFromFile(resolved);

    for (const r of report.results) {
      integrations.push({
        provider: r.provider,
        status: r.status,
        message: r.message,
      });
      counts[r.status]++;
    }
  } catch {
    // .env not found or unreadable — all integrations unknown
  }

  return { integrations, counts };
}
