/**
 * Agent destruction with deletion receipt.
 *
 * Wipes all agent data from the deployment directory and produces
 * a receipt recording what was deleted and when.
 */

import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { formatBytes } from "./format.js";
import type {
  DeletionReceipt,
  DestroyedFile,
  DestroyOptions,
  DestroyResult,
  LifecycleProgressCallback,
} from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function progress(
  cb: LifecycleProgressCallback | undefined,
  step: "stop" | "inventory" | "wipe" | "verify",
  status: "running" | "done" | "failed" | "skipped",
  message: string,
): void {
  cb?.({ step, status, message });
}

/** Recursively collect all file paths in a directory. */
async function collectAllFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectAllFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Overwrite a file with random data before deletion to prevent recovery. */
async function secureWipe(filePath: string): Promise<void> {
  try {
    const stat = statSync(filePath);
    if (stat.size > 0) {
      const randomData = randomBytes(stat.size);
      await writeFile(filePath, randomData);
      await writeFile(filePath, Buffer.alloc(stat.size));
    }
  } catch {
    // Secure-wipe failure — continue with normal unlink
  }
}

// ── Destruction Pipeline ────────────────────────────────────────────────────

/**
 * Destroy all agent data and produce a deletion receipt.
 *
 * Pipeline:
 *   1. Stop — verify no running containers (advisory)
 *   2. Inventory — enumerate all files for the receipt
 *   3. Wipe — secure-overwrite then delete all files
 *   4. Verify — confirm directory is empty/removed
 */
export async function destroyAgent(options: DestroyOptions): Promise<DestroyResult> {
  const { deployDir, onProgress } = options;

  if (!existsSync(deployDir)) {
    return { success: false, error: `Deployment directory not found: ${deployDir}` };
  }

  // ── Step 1: Stop advisory ──────────────────────────────────────────────
  progress(onProgress, "stop", "running", "Checking for running agent...");

  const composePath = join(deployDir, "engine", "docker-compose.yml");
  if (existsSync(composePath)) {
    progress(onProgress, "stop", "done", "Agent should be stopped before destruction (use `clawhq down`)");
  } else {
    progress(onProgress, "stop", "skipped", "No compose file found");
  }

  // ── Step 2: Inventory ──────────────────────────────────────────────────
  progress(onProgress, "inventory", "running", "Inventorying files...");

  const allFilePaths = await collectAllFiles(deployDir);
  const destroyedFiles: DestroyedFile[] = [];
  let totalBytes = 0;

  for (const filePath of allFilePaths) {
    try {
      const stat = statSync(filePath);
      destroyedFiles.push({
        path: relative(deployDir, filePath),
        sizeBefore: stat.size,
      });
      totalBytes += stat.size;
    } catch {
      // Stat failure — file will still be destroyed
    }
  }

  progress(
    onProgress,
    "inventory",
    "done",
    `Inventoried ${destroyedFiles.length} files (${formatBytes(totalBytes)})`,
  );

  // ── Step 3: Secure wipe ────────────────────────────────────────────────
  progress(onProgress, "wipe", "running", "Secure-wiping all agent data...");

  for (const filePath of allFilePaths) {
    await secureWipe(filePath);
  }

  await rm(deployDir, { recursive: true, force: true });

  progress(onProgress, "wipe", "done", `Wiped ${destroyedFiles.length} files`);

  // ── Step 4: Verify ────────────────────────────────────────────────────
  progress(onProgress, "verify", "running", "Verifying destruction...");

  if (existsSync(deployDir)) {
    progress(onProgress, "verify", "failed", "Deployment directory still exists");
    return { success: false, error: "Failed to fully remove deployment directory." };
  }

  progress(onProgress, "verify", "done", "Deployment directory removed");

  // ── Write deletion receipt ─────────────────────────────────────────────
  const receipt: DeletionReceipt = {
    version: 1,
    destroyedAt: new Date().toISOString(),
    deployDir,
    files: [...destroyedFiles].sort((a, b) => a.path.localeCompare(b.path)),
    totalBytes,
  };

  const receiptPath = join(deployDir, "..", `clawhq-deletion-receipt-${Date.now()}.json`);
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), "utf-8");

  return { success: true, receiptPath, receipt };
}
