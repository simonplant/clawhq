/**
 * Memory lifecycle engine — hot/warm/cold tier transitions.
 *
 * Scans workspace/memory/ for entries, applies retention policies,
 * and transitions entries between tiers. Warm transitions trigger
 * LLM summarization; cold transitions trigger PII masking.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";
import { writeFileAtomic } from "../../design/configure/writer.js";
import { maskPii } from "../lifecycle/mask.js";

import { summarizeMemory } from "./summarize.js";
import type {
  LifecycleRunResult,
  MemoryEntry,
  MemoryLifecycleConfig,
  MemoryLifecycleOptions,
  MemoryManifest,
  MemoryProgress,
  MemoryProgressCallback,
  TransitionResult,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const MANIFEST_FILENAME = ".memory-manifest.json";
const MEMORY_BASE = "workspace/memory";
const TIER_DIRS: Record<string, string> = {
  hot: "hot",
  warm: "warm",
  cold: "cold",
};

/** Default config when none is provided. */
export const DEFAULT_CONFIG: MemoryLifecycleConfig = {
  hotMaxBytes: 50 * 1024, // 50KB
  hotRetentionHours: 24,
  warmRetentionHours: 168, // 7 days
  coldRetentionHours: 0, // never purge
  summarization: "balanced",
};

// ── Manifest I/O ─────────────────────────────────────────────────────────────

function manifestPath(deployDir: string): string {
  return join(deployDir, MEMORY_BASE, MANIFEST_FILENAME);
}

export async function loadManifest(
  deployDir: string,
): Promise<MemoryManifest> {
  const path = manifestPath(deployDir);
  if (!existsSync(path)) {
    return { version: 1, entries: [] };
  }
  // Corruption no longer silently degrades to an empty manifest — the next
  // saveManifest would otherwise persist the empty form, losing every
  // memory-tier classification.
  const raw = await readFile(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `memory manifest at ${path} is corrupt: ${msg}. ` +
      `Memory files in workspace/memory/ are unaffected; restore the manifest from a backup (.bak) ` +
      `or rebuild it with \`clawhq evolve memory scan\`.`,
      { cause: err },
    );
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).entries)) {
    throw new Error(`memory manifest at ${path} is missing the \`entries\` array`);
  }
  return parsed as MemoryManifest;
}

async function saveManifest(
  deployDir: string,
  manifest: MemoryManifest,
): Promise<void> {
  const dir = join(deployDir, MEMORY_BASE);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE_SECRET });
  // Atomic write + 0600 mode (manifest contains PII-masked memory index)
  writeFileAtomic(manifestPath(deployDir), JSON.stringify(manifest, null, 2) + "\n", FILE_MODE_SECRET);
}

// ── Directory Helpers ────────────────────────────────────────────────────────

function tierDir(deployDir: string, tier: string): string {
  return join(deployDir, MEMORY_BASE, TIER_DIRS[tier]);
}

function ensureTierDirs(deployDir: string): void {
  for (const tier of Object.values(TIER_DIRS)) {
    mkdirSync(join(deployDir, MEMORY_BASE, tier), { recursive: true, mode: DIR_MODE_SECRET });
  }
}

// ── Scanning ─────────────────────────────────────────────────────────────────

/**
 * Scan a tier directory for memory files and build entry metadata.
 * Only considers .md, .txt, .json, .jsonl files.
 */
function scanTier(deployDir: string, tier: string): MemoryEntry[] {
  const dir = tierDir(deployDir, tier);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(
    (f) =>
      !f.startsWith(".") &&
      (f.endsWith(".md") ||
        f.endsWith(".txt") ||
        f.endsWith(".json") ||
        f.endsWith(".jsonl")),
  );

  return files.map((f) => {
    const fullPath = join(dir, f);
    const stat = statSync(fullPath);
    const id = f.replace(/\.[^.]+$/, "");
    return {
      id,
      tier: tier as "hot" | "warm" | "cold",
      createdAt: stat.birthtime.toISOString(),
      transitionedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      summarized: tier !== "hot",
      piiMasked: tier === "cold",
      relativePath: `${TIER_DIRS[tier]}/${f}`,
    };
  });
}

/** Scan all tiers and reconcile with manifest. */
export function scanAllTiers(deployDir: string): MemoryEntry[] {
  ensureTierDirs(deployDir);
  return [
    ...scanTier(deployDir, "hot"),
    ...scanTier(deployDir, "warm"),
    ...scanTier(deployDir, "cold"),
  ];
}

// ── Progress Helper ──────────────────────────────────────────────────────────

function progress(
  cb: MemoryProgressCallback | undefined,
  step: MemoryProgress["step"],
  status: MemoryProgress["status"],
  message: string,
): void {
  cb?.({ step, status, message });
}

// ── Lifecycle Engine ─────────────────────────────────────────────────────────

/**
 * Run the full memory lifecycle.
 *
 * 1. Scan all tiers for entries
 * 2. Identify entries that need transitioning based on retention policy
 * 3. Hot → Warm: summarize with LLM
 * 4. Warm → Cold: mask PII
 * 5. Cold → Purge (if coldRetentionHours > 0 and expired)
 * 6. Update manifest
 */
export async function runLifecycle(
  options: MemoryLifecycleOptions,
): Promise<LifecycleRunResult> {
  const { deployDir, onProgress } = options;
  const config = options.config ?? DEFAULT_CONFIG;
  const now = new Date();
  const transitions: TransitionResult[] = [];
  const purged: string[] = [];

  ensureTierDirs(deployDir);

  // ── Step 1: Scan ──────────────────────────────────────────────────────
  progress(onProgress, "scan", "running", "Scanning memory tiers...");
  const entries = scanAllTiers(deployDir);
  progress(
    onProgress,
    "scan",
    "done",
    `Found ${entries.length} memory entries across 3 tiers`,
  );

  // ── Step 2: Identify transitions ──────────────────────────────────────
  const hotEntries = entries.filter((e) => e.tier === "hot");
  const warmEntries = entries.filter((e) => e.tier === "warm");
  const coldEntries = entries.filter((e) => e.tier === "cold");

  const hotToWarm = hotEntries.filter((e) => {
    // Use transitionedAt (mtime) for age — birthtime is unreliable on Linux
    const age = (now.getTime() - new Date(e.transitionedAt).getTime()) / 3600000;
    return age >= config.hotRetentionHours;
  });

  const warmToCold = warmEntries.filter((e) => {
    const age =
      (now.getTime() - new Date(e.transitionedAt).getTime()) / 3600000;
    return age >= config.warmRetentionHours;
  });

  const coldToPurge =
    config.coldRetentionHours > 0
      ? coldEntries.filter((e) => {
          const age =
            (now.getTime() - new Date(e.transitionedAt).getTime()) / 3600000;
          return age >= config.coldRetentionHours;
        })
      : [];

  // ── Step 3: Hot → Warm (summarize) ────────────────────────────────────
  if (hotToWarm.length > 0) {
    progress(
      onProgress,
      "summarize",
      "running",
      `Summarizing ${hotToWarm.length} hot entries...`,
    );

    for (const entry of hotToWarm) {
      const result = await transitionHotToWarm(deployDir, entry, config);
      transitions.push(result);
    }

    progress(onProgress, "summarize", "done", `Summarized ${hotToWarm.length} entries`);
  } else {
    progress(onProgress, "summarize", "skipped", "No hot entries ready for summarization");
  }

  // ── Step 4: Warm → Cold (PII mask) ───────────────────────────────────
  if (warmToCold.length > 0) {
    progress(
      onProgress,
      "mask",
      "running",
      `Masking PII in ${warmToCold.length} warm entries...`,
    );

    for (const entry of warmToCold) {
      const result = await transitionWarmToCold(deployDir, entry);
      transitions.push(result);
    }

    progress(onProgress, "mask", "done", `Masked ${warmToCold.length} entries`);
  } else {
    progress(onProgress, "mask", "skipped", "No warm entries ready for cold storage");
  }

  // ── Step 5: Cold → Purge ──────────────────────────────────────────────
  if (coldToPurge.length > 0) {
    progress(
      onProgress,
      "cleanup",
      "running",
      `Purging ${coldToPurge.length} expired cold entries...`,
    );

    for (const entry of coldToPurge) {
      const filePath = join(deployDir, MEMORY_BASE, entry.relativePath);
      if (existsSync(filePath)) {
        await rm(filePath);
      }
      purged.push(entry.id);
    }

    progress(onProgress, "cleanup", "done", `Purged ${coldToPurge.length} entries`);
  } else {
    progress(onProgress, "cleanup", "skipped", "No cold entries expired");
  }

  // ── Step 6: Update manifest ───────────────────────────────────────────
  const updatedEntries = scanAllTiers(deployDir);
  const manifest: MemoryManifest = {
    version: 1,
    entries: updatedEntries,
    lastRunAt: now.toISOString(),
  };
  await saveManifest(deployDir, manifest);

  // Calculate tier sizes
  const hotSize = updatedEntries
    .filter((e) => e.tier === "hot")
    .reduce((sum, e) => sum + e.sizeBytes, 0);
  const warmSize = updatedEntries
    .filter((e) => e.tier === "warm")
    .reduce((sum, e) => sum + e.sizeBytes, 0);
  const coldSize = updatedEntries
    .filter((e) => e.tier === "cold")
    .reduce((sum, e) => sum + e.sizeBytes, 0);

  return {
    success: true,
    timestamp: now.toISOString(),
    transitions,
    purged,
    hotSizeBytes: hotSize,
    warmSizeBytes: warmSize,
    coldSizeBytes: coldSize,
    totalEntries: updatedEntries.length,
  };
}

// ── Tier Transitions ─────────────────────────────────────────────────────────

async function transitionHotToWarm(
  deployDir: string,
  entry: MemoryEntry,
  config: MemoryLifecycleConfig,
): Promise<TransitionResult> {
  const srcPath = join(deployDir, MEMORY_BASE, entry.relativePath);
  const parts = entry.relativePath.split("/");
  const filename = parts[parts.length - 1];
  const dstPath = join(tierDir(deployDir, "warm"), filename);

  const content = await readFile(srcPath, "utf-8");

  // Attempt LLM summarization
  const summarizeResult = await summarizeMemory({
    text: content,
    strategy: config.summarization,
  });

  const outputContent = summarizeResult.success && summarizeResult.summary
    ? summarizeResult.summary
    : content;

  await writeFile(dstPath, outputContent);
  await rm(srcPath);

  const stat = statSync(dstPath);

  return {
    entryId: entry.id,
    fromTier: "hot",
    toTier: "warm",
    summarized: summarizeResult.success,
    piiMasked: false,
    newSizeBytes: stat.size,
  };
}

async function transitionWarmToCold(
  deployDir: string,
  entry: MemoryEntry,
): Promise<TransitionResult> {
  const srcPath = join(deployDir, MEMORY_BASE, entry.relativePath);
  const parts = entry.relativePath.split("/");
  const filename = parts[parts.length - 1];
  const dstPath = join(tierDir(deployDir, "cold"), filename);

  const content = await readFile(srcPath, "utf-8");

  // Mask PII before cold storage
  const maskResult = maskPii(content);

  await writeFile(dstPath, maskResult.text);
  await rm(srcPath);

  const stat = statSync(dstPath);

  return {
    entryId: entry.id,
    fromTier: "warm",
    toTier: "cold",
    summarized: true,
    piiMasked: maskResult.maskedCount > 0,
    newSizeBytes: stat.size,
  };
}
