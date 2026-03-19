/**
 * Memory status — aggregates tier info for display.
 */

import {
  DEFAULT_CONFIG,
  loadManifest,
  scanAllTiers,
} from "./lifecycle.js";
import type {
  MemoryLifecycleConfig,
  MemoryStatus,
  MemoryStatusOptions,
  TierStatus,
} from "./types.js";

/**
 * Get the current memory status across all tiers.
 */
export async function getMemoryStatus(
  options: MemoryStatusOptions,
  config?: MemoryLifecycleConfig,
): Promise<MemoryStatus> {
  const { deployDir } = options;
  const entries = scanAllTiers(deployDir);
  const manifest = await loadManifest(deployDir);

  const tiers: TierStatus[] = (["hot", "warm", "cold"] as const).map(
    (tier) => {
      const tierEntries = entries.filter((e) => e.tier === tier);
      return {
        tier,
        entryCount: tierEntries.length,
        totalSizeBytes: tierEntries.reduce((sum, e) => sum + e.sizeBytes, 0),
      };
    },
  );

  return {
    tiers,
    totalEntries: entries.length,
    totalSizeBytes: entries.reduce((sum, e) => sum + e.sizeBytes, 0),
    lastRunAt: manifest.lastRunAt,
    config: config ?? DEFAULT_CONFIG,
  };
}
