/**
 * Tiered memory store.
 *
 * Manages reading and writing structured memory entries across hot/warm/cold
 * tiers on the filesystem. Each tier is a directory containing JSON files,
 * one per entry.
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { MemoryHealthReport, MemoryTierName, StructuredMemoryEntry, TierPolicy } from "./types.js";
import { DEFAULT_TIER_POLICY } from "./types.js";

/** Resolve the base memory directory under the OpenClaw workspace. */
function memoryDir(openclawHome: string): string {
  return join(openclawHome.replace(/^~/, process.env.HOME ?? "~"), "workspace", "memory");
}

/** Resolve the directory for a specific tier. */
function tierDir(openclawHome: string, tier: MemoryTierName): string {
  return join(memoryDir(openclawHome), tier);
}

/** Ensure a tier directory exists. */
async function ensureTier(openclawHome: string, tier: MemoryTierName): Promise<string> {
  const dir = tierDir(openclawHome, tier);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Write a structured memory entry to a tier.
 */
export async function writeEntry(
  openclawHome: string,
  tier: MemoryTierName,
  entry: StructuredMemoryEntry,
): Promise<void> {
  const dir = await ensureTier(openclawHome, tier);
  const filePath = join(dir, `${entry.id}.json`);
  await writeFile(filePath, JSON.stringify(entry, null, 2), "utf-8");
}

/**
 * Read a single entry by ID from a specific tier.
 */
export async function readEntry(
  openclawHome: string,
  tier: MemoryTierName,
  id: string,
): Promise<StructuredMemoryEntry | null> {
  const filePath = join(tierDir(openclawHome, tier), `${id}.json`);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as StructuredMemoryEntry;
  } catch {
    return null;
  }
}

/**
 * List all entries in a given tier.
 */
export async function listEntries(
  openclawHome: string,
  tier: MemoryTierName,
): Promise<StructuredMemoryEntry[]> {
  const dir = tierDir(openclawHome, tier);
  const entries: StructuredMemoryEntry[] = [];

  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        entries.push(JSON.parse(raw) as StructuredMemoryEntry);
      } catch {
        // Skip malformed entries
      }
    }
  } catch {
    // Directory doesn't exist — return empty
  }

  return entries;
}

/**
 * Delete an entry from a tier.
 */
export async function deleteEntry(
  openclawHome: string,
  tier: MemoryTierName,
  id: string,
): Promise<boolean> {
  const filePath = join(tierDir(openclawHome, tier), `${id}.json`);
  try {
    await rm(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the total size in bytes of all entries in a tier.
 */
export async function tierSize(
  openclawHome: string,
  tier: MemoryTierName,
): Promise<{ sizeBytes: number; fileCount: number }> {
  const dir = tierDir(openclawHome, tier);
  let sizeBytes = 0;
  let fileCount = 0;

  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const s = await stat(join(dir, file));
        sizeBytes += s.size;
        fileCount++;
      } catch {
        // Skip unreadable
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return { sizeBytes, fileCount };
}

/**
 * Compute the age of an entry in days.
 */
export function entryAgeDays(entry: StructuredMemoryEntry, now?: Date): number {
  const ref = now ?? new Date();
  const created = new Date(entry.createdAt);
  return Math.floor((ref.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Find entries in a tier that should be transitioned to the next tier
 * based on the policy.
 */
export async function findTransitionCandidates(
  openclawHome: string,
  tier: MemoryTierName,
  policy: TierPolicy = DEFAULT_TIER_POLICY,
): Promise<StructuredMemoryEntry[]> {
  const entries = await listEntries(openclawHome, tier);
  const now = new Date();
  const candidates: StructuredMemoryEntry[] = [];

  if (tier === "hot") {
    // Hot -> warm: age > hotMaxDays OR hot tier over budget
    const { sizeBytes } = await tierSize(openclawHome, "hot");
    const overBudget = sizeBytes > policy.hotMaxBytes;

    for (const entry of entries) {
      const age = entryAgeDays(entry, now);
      if (age > policy.hotMaxDays || overBudget) {
        candidates.push(entry);
      }
    }

    // If over budget, sort by age (oldest first) so we move the oldest
    if (overBudget) {
      candidates.sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }
  } else if (tier === "warm") {
    // Warm -> cold: age > warmMaxDays
    for (const entry of entries) {
      const age = entryAgeDays(entry, now);
      if (age > policy.warmMaxDays) {
        candidates.push(entry);
      }
    }
  } else if (tier === "cold" && policy.deleteColdBeyondMax) {
    // Cold -> delete: age > coldMaxDays
    for (const entry of entries) {
      const age = entryAgeDays(entry, now);
      if (age > policy.coldMaxDays) {
        candidates.push(entry);
      }
    }
  }

  return candidates;
}

/**
 * Collect a memory health report for doctor/status integration.
 */
export async function collectMemoryHealth(
  openclawHome: string,
  policy: TierPolicy = DEFAULT_TIER_POLICY,
): Promise<MemoryHealthReport> {
  const tiers: MemoryTierName[] = ["hot", "warm", "cold"];
  const tierReports: MemoryHealthReport["tiers"] = [];
  let totalEntries = 0;
  let totalSizeBytes = 0;
  let staleEntriesCount = 0;
  let pendingTransitions = 0;

  const now = new Date();

  for (const tierName of tiers) {
    const entries = await listEntries(openclawHome, tierName);
    const { sizeBytes } = await tierSize(openclawHome, tierName);
    const ages = entries.map((e) => entryAgeDays(e, now));

    tierReports.push({
      name: tierName,
      entryCount: entries.length,
      sizeBytes,
      oldestEntryAge: ages.length > 0 ? Math.max(...ages) : null,
      newestEntryAge: ages.length > 0 ? Math.min(...ages) : null,
    });

    totalEntries += entries.length;
    totalSizeBytes += sizeBytes;

    // Count stale entries (not accessed in 30+ days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    staleEntriesCount += entries.filter(
      (e) => new Date(e.lastAccessedAt) < thirtyDaysAgo,
    ).length;

    const candidates = await findTransitionCandidates(openclawHome, tierName, policy);
    pendingTransitions += candidates.length;
  }

  const hotReport = tierReports.find((t) => t.name === "hot");
  const hotOverBudget = hotReport ? hotReport.sizeBytes > policy.hotMaxBytes : false;

  return {
    tiers: tierReports,
    totalEntries,
    totalSizeBytes,
    hotTierOverBudget: hotOverBudget,
    staleEntriesCount,
    pendingTransitions,
    pendingConnections: 0,
  };
}
