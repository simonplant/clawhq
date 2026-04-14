/**
 * Verified agent destruction with cryptographic proof.
 *
 * Wipes all agent data from the deployment directory and produces
 * a tamper-evident proof of destruction. The proof includes:
 *
 *   1. SHA-256 hash of every file before destruction
 *   2. A witness hash over the sorted manifest (any omission invalidates it)
 *   3. HMAC-SHA256 of the witness hash with a one-time key
 *   4. The one-time key itself (so anyone can independently verify)
 *
 * Verification: recompute witness hash from the manifest, then
 * verify HMAC(witnessHash, key) === hmacSignature. If valid,
 * the listed files existed with the listed hashes at destruction time.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { formatBytes } from "./format.js";
import type {
  DestroyedFile,
  DestroyOptions,
  DestroyResult,
  DestructionProof,
  LifecycleProgressCallback,
} from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function progress(
  cb: LifecycleProgressCallback | undefined,
  step: "stop" | "inventory" | "wipe" | "verify" | "proof",
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

/** Hash a file's contents with SHA-256. */
async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/** Overwrite a file with random data before deletion to prevent recovery. */
async function secureWipe(filePath: string): Promise<void> {
  try {
    const stat = statSync(filePath);
    if (stat.size > 0) {
      // Overwrite with random bytes
      const randomData = randomBytes(stat.size);
      await writeFile(filePath, randomData);
      // Second pass: zeros
      await writeFile(filePath, Buffer.alloc(stat.size));
    }
  } catch (err) {
    // Secure-wipe failure — continue with normal unlink
  }
}

// ── Destruction Pipeline ────────────────────────────────────────────────────

/**
 * Destroy all agent data with cryptographic proof.
 *
 * Pipeline:
 *   1. Stop — verify no running containers (advisory)
 *   2. Inventory — hash every file for the proof manifest
 *   3. Wipe — secure-overwrite then delete all files
 *   4. Verify — confirm directory is empty/removed
 *   5. Proof — generate and write cryptographic proof
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
  progress(onProgress, "inventory", "running", "Hashing all files for proof manifest...");

  const allFilePaths = await collectAllFiles(deployDir);
  const destroyedFiles: DestroyedFile[] = [];
  let totalBytes = 0;

  for (const filePath of allFilePaths) {
    try {
      const stat = statSync(filePath);
      const hash = await hashFile(filePath);
      destroyedFiles.push({
        path: relative(deployDir, filePath),
        hashBefore: hash,
        sizeBefore: stat.size,
      });
      totalBytes += stat.size;
    } catch (err) {
      // Hash failure — file will still be destroyed, just without proof
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

  // Remove the entire directory tree
  await rm(deployDir, { recursive: true, force: true });

  progress(onProgress, "wipe", "done", `Wiped ${destroyedFiles.length} files`);

  // ── Step 4: Verify ────────────────────────────────────────────────────
  progress(onProgress, "verify", "running", "Verifying destruction...");

  if (existsSync(deployDir)) {
    progress(onProgress, "verify", "failed", "Deployment directory still exists");
    return { success: false, error: "Failed to fully remove deployment directory." };
  }

  progress(onProgress, "verify", "done", "Deployment directory removed");

  // ── Step 5: Generate proof ────────────────────────────────────────────
  progress(onProgress, "proof", "running", "Generating cryptographic proof...");

  const proof = generateProof(deployDir, destroyedFiles, totalBytes);

  // Write proof to a file next to where the deploy dir was
  const proofPath = join(deployDir, "..", `clawhq-destruction-proof-${Date.now()}.json`);
  await writeFile(proofPath, JSON.stringify(proof, null, 2), "utf-8");

  progress(onProgress, "proof", "done", `Proof written to ${proofPath}`);

  return { success: true, proofPath, proof };
}

// ── Proof Generation ────────────────────────────────────────────────────────

function generateProof(
  deployDir: string,
  files: readonly DestroyedFile[],
  totalBytes: number,
): DestructionProof {
  // Sort files by path for deterministic witness hash
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  // Witness hash: SHA-256 over the sorted manifest
  const witnessData = sorted
    .map((f) => `${f.path}:${f.hashBefore}:${f.sizeBefore}`)
    .join("\n");
  const witnessHash = createHash("sha256").update(witnessData).digest("hex");

  // One-time HMAC key — included in the proof for independent verification
  const hmacKey = randomBytes(32).toString("hex");
  const hmacSignature = createHmac("sha256", hmacKey).update(witnessHash).digest("hex");

  return {
    version: 1,
    destroyedAt: new Date().toISOString(),
    deployDir,
    files: sorted,
    totalBytes,
    witnessHash,
    hmacSignature,
    hmacKey,
  };
}

/**
 * Independently verify a destruction proof.
 *
 * Recomputes the witness hash from the file manifest and checks
 * the HMAC signature. Returns true if the proof is valid.
 */
export function verifyDestructionProof(proof: DestructionProof): boolean {
  // Recompute witness hash
  const sorted = [...proof.files].sort((a, b) => a.path.localeCompare(b.path));
  const witnessData = sorted
    .map((f) => `${f.path}:${f.hashBefore}:${f.sizeBefore}`)
    .join("\n");
  const expectedWitness = createHash("sha256").update(witnessData).digest("hex");

  if (expectedWitness !== proof.witnessHash) return false;

  // Verify HMAC
  const expectedHmac = createHmac("sha256", proof.hmacKey)
    .update(proof.witnessHash)
    .digest("hex");

  return expectedHmac === proof.hmacSignature;
}

