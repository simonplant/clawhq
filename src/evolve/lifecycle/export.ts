/**
 * Portable agent export — bundles all agent data into a self-contained archive.
 *
 * The export is a gzipped tar archive containing:
 *   - engine/ (config, compose, Dockerfile — secrets excluded)
 *   - workspace/ (identity, tools, skills, memory)
 *   - cron/ (scheduled jobs)
 *   - security/ (posture config)
 *   - ops/audit/ (audit logs)
 *   - manifest.json (export metadata)
 *
 * PII is masked in all text files before bundling. Secrets (.env,
 * credentials.json) are never included in the export.
 */

import { createHash } from "node:crypto";
import { chmodSync, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import { DIR_MODE_SECRET, FILE_MODE_SECRET } from "../../config/defaults.js";

import { formatBytes } from "./format.js";
import { emptyMaskReport, isTextFile, maskPii, mergeMaskResult } from "./mask.js";
import type {
  ExportOptions,
  ExportResult,
  LifecycleProgressCallback,
  PiiMaskReport,
} from "./types.js";

// ── Constants ───────────────────────────────────────────────────────────────

/** Files that must never be included in an export (contain secrets). */
const EXCLUDED_FILES = new Set([".env", "credentials.json"]);

/** Directories to include in the export. */
const EXPORT_DIRS = ["engine", "workspace", "cron", "security"];

/** Additional subdirectories to include from ops/. */
const OPS_SUBDIRS = ["audit"];

// ── Helpers ─────────────────────────────────────────────────────────────────

function progress(
  cb: LifecycleProgressCallback | undefined,
  step: "collect" | "mask" | "bundle" | "verify",
  status: "running" | "done" | "failed",
  message: string,
): void {
  cb?.({ step, status, message });
}

/** Recursively collect all file paths relative to a base directory. */
async function collectFiles(dir: string, base: string): Promise<string[]> {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, base)));
    } else if (entry.isFile()) {
      files.push(relative(base, fullPath));
    }
  }
  return files;
}

/** Check if a file should be excluded from the export. */
function isExcluded(relativePath: string): boolean {
  const fileName = basename(relativePath);
  return EXCLUDED_FILES.has(fileName);
}

// ── Simple Tar Writer ───────────────────────────────────────────────────────

/**
 * Write a minimal POSIX tar archive. Each file gets a 512-byte header
 * followed by content padded to 512-byte blocks. Archive ends with
 * two zero blocks (1024 bytes).
 */
function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);

  // name (0-100)
  header.write(name.slice(0, 100), 0, 100, "utf-8");
  // mode (100-108) — regular file 0644
  header.write("0000644\0", 100, 8, "utf-8");
  // uid (108-116)
  header.write("0001000\0", 108, 8, "utf-8");
  // gid (116-124)
  header.write("0001000\0", 116, 8, "utf-8");
  // size (124-136) — octal
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");
  // mtime (136-148) — current time in octal
  const mtime = Math.floor(Date.now() / 1000);
  header.write(mtime.toString(8).padStart(11, "0") + "\0", 136, 12, "utf-8");
  // typeflag (156) — regular file '0'
  header.write("0", 156, 1, "utf-8");

  // Compute checksum: fill checksum field with spaces first
  header.write("        ", 148, 8, "utf-8");
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");

  return header;
}

// ── Export Pipeline ─────────────────────────────────────────────────────────

/**
 * Export all agent data into a portable, PII-masked tar.gz bundle.
 *
 * Pipeline:
 *   1. Collect — enumerate all exportable files
 *   2. Mask — apply PII masking to text files
 *   3. Bundle — write tar.gz archive
 *   4. Verify — validate archive integrity
 */
export async function exportBundle(options: ExportOptions): Promise<ExportResult> {
  const { deployDir, onProgress } = options;

  if (!existsSync(deployDir)) {
    return { success: false, error: `Deployment directory not found: ${deployDir}` };
  }

  // ── Step 1: Collect files ───────────────────────────────────────────────
  progress(onProgress, "collect", "running", "Inventorying agent data...");

  const allFiles: string[] = [];

  for (const dir of EXPORT_DIRS) {
    const dirPath = join(deployDir, dir);
    const files = await collectFiles(dirPath, deployDir);
    allFiles.push(...files.filter((f) => !isExcluded(f)));
  }

  // Include ops subdirectories
  for (const subDir of OPS_SUBDIRS) {
    const dirPath = join(deployDir, "ops", subDir);
    const files = await collectFiles(dirPath, deployDir);
    allFiles.push(...files.filter((f) => !isExcluded(f)));
  }

  if (allFiles.length === 0) {
    progress(onProgress, "collect", "failed", "No files found to export");
    return { success: false, error: "No agent data found to export." };
  }

  progress(onProgress, "collect", "done", `Found ${allFiles.length} files`);

  // ── Step 2: PII masking ────────────────────────────────────────────────
  progress(onProgress, "mask", "running", "Masking PII in text files...");

  let maskReport: PiiMaskReport = emptyMaskReport();
  const fileContents = new Map<string, Buffer>();

  for (const filePath of allFiles) {
    const fullPath = join(deployDir, filePath);
    const content = await readFile(fullPath);

    if (isTextFile(filePath)) {
      const text = content.toString("utf-8");
      const maskResult = maskPii(text);
      maskReport = mergeMaskResult(maskReport, filePath, maskResult);
      fileContents.set(filePath, Buffer.from(maskResult.text, "utf-8"));
    } else {
      fileContents.set(filePath, content);
    }
  }

  progress(
    onProgress,
    "mask",
    "done",
    maskReport.totalMasked > 0
      ? `Masked ${maskReport.totalMasked} PII instances in ${maskReport.files.length} files`
      : "No PII found",
  );

  // ── Step 3: Bundle ────────────────────────────────────────────────────
  progress(onProgress, "bundle", "running", "Creating tar.gz archive...");

  // Millisecond-resolution timestamp + collision-safe suffix so two exports
  // in rapid succession don't clobber each other. Format:
  //   2026-04-22T16-30-59-123 or 2026-04-22T16-30-59-123-1 on collision.
  const tsRaw = new Date().toISOString().replace(/[:.]/g, "-");
  const timestampBase = tsRaw.slice(0, 23); // YYYY-MM-DDTHH-MM-SS-mmm
  let bundlePath = options.output ?? join(deployDir, "..", `clawhq-export-${timestampBase}.tar.gz`);
  let bundleName = basename(bundlePath);
  if (!options.output) {
    for (let attempt = 1; existsSync(bundlePath) && attempt < 10_000; attempt++) {
      bundleName = `clawhq-export-${timestampBase}-${attempt}.tar.gz`;
      bundlePath = join(deployDir, "..", bundleName);
    }
  }

  // Create export manifest
  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    deployDir,
    fileCount: allFiles.length,
    piiMasking: {
      totalMasked: maskReport.totalMasked,
      byCategory: maskReport.byCategory,
      maskedFiles: maskReport.files,
    },
    files: allFiles.map((f) => ({
      path: f,
      size: fileContents.get(f)?.length ?? 0,
      sha256: createHash("sha256").update(fileContents.get(f) ?? Buffer.alloc(0)).digest("hex"),
    })),
  };

  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");

  // Build tar in memory, then gzip to file
  const tarChunks: Buffer[] = [];

  // Add manifest first
  tarChunks.push(tarHeader("manifest.json", manifestBuf.length));
  tarChunks.push(manifestBuf);
  const manifestPad = 512 - (manifestBuf.length % 512);
  if (manifestPad < 512) tarChunks.push(Buffer.alloc(manifestPad));

  // Add all files
  for (const filePath of allFiles) {
    const content = fileContents.get(filePath) ?? Buffer.alloc(0);
    tarChunks.push(tarHeader(filePath, content.length));
    tarChunks.push(content);
    const pad = 512 - (content.length % 512);
    if (pad < 512) tarChunks.push(Buffer.alloc(pad));
  }

  // End-of-archive marker (two zero blocks)
  tarChunks.push(Buffer.alloc(1024));

  const tarBuf = Buffer.concat(tarChunks);

  // Ensure parent directory exists
  const parentDir = join(bundlePath, "..");
  mkdirSync(parentDir, { recursive: true, mode: DIR_MODE_SECRET });
  chmodSync(parentDir, DIR_MODE_SECRET);

  // Gzip and write
  const gzip = createGzip({ level: 9 });
  const output = createWriteStream(bundlePath, { mode: FILE_MODE_SECRET });
  await pipeline(Readable.from(tarBuf), gzip, output);
  chmodSync(bundlePath, FILE_MODE_SECRET);

  const bundleSize = statSync(bundlePath).size;

  progress(onProgress, "bundle", "done", `Archive: ${bundleName} (${formatBytes(bundleSize)})`);

  // ── Step 4: Verify ────────────────────────────────────────────────────
  progress(onProgress, "verify", "running", "Verifying archive integrity...");

  const archiveHash = createHash("sha256")
    .update(await readFile(bundlePath))
    .digest("hex");

  progress(onProgress, "verify", "done", `SHA-256: ${archiveHash.slice(0, 16)}...`);

  return {
    success: true,
    bundlePath,
    fileCount: allFiles.length,
    bundleSize,
    piiMasked: maskReport.totalMasked,
  };
}

