/**
 * Main export orchestration.
 *
 * Collects files, applies PII masking (if requested), generates README
 * and integrity manifest, then packages as tar.gz.
 */

import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { collectExportFiles, generateExportId, hashContent } from "./collector.js";
import { maskPiiInDirectory } from "./pii.js";
import { generateBundleReadme } from "./readme.js";
import type { ExportManifest, ExportOptions, ExportResult } from "./types.js";
import { ExportError } from "./types.js";

const execFileAsync = promisify(execFile);

const MANIFEST_VERSION = 1;

/**
 * Create a portable export bundle.
 *
 * Steps:
 * 1. Collect files into staging directory (secrets redacted)
 * 2. Apply PII masking if --mask-pii
 * 3. Generate README.md
 * 4. Generate integrity manifest
 * 5. Package as tar.gz
 */
export async function createExport(
  opts: ExportOptions,
): Promise<ExportResult> {
  const exportId = generateExportId();
  const stagingDir = join(tmpdir(), `clawhq-export-${exportId}`);
  const bundleDir = join(stagingDir, exportId);

  try {
    // Create staging directory
    await mkdir(bundleDir, { recursive: true });

    // 1. Collect files (secrets redacted from config)
    const files = await collectExportFiles(
      opts.openclawHome,
      bundleDir,
      opts.noMemory ?? false,
    );

    if (files.length === 0) {
      throw new ExportError(
        "No files found to export. Check that openclawHome exists and contains agent state.",
        "NO_FILES",
        { openclawHome: opts.openclawHome },
      );
    }

    // 2. Apply PII masking if requested
    if (opts.maskPii) {
      await maskPiiInDirectory(bundleDir);
    }

    // 3. Build manifest
    const manifest: ExportManifest = {
      exportId,
      timestamp: new Date().toISOString(),
      version: MANIFEST_VERSION,
      flags: {
        maskPii: opts.maskPii ?? false,
        noMemory: opts.noMemory ?? false,
      },
      files,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
    };

    // Write manifest to bundle
    const manifestJson = JSON.stringify(manifest, null, 2);
    const manifestPath = join(bundleDir, "manifest.json");
    await writeFile(manifestPath, manifestJson, "utf-8");

    // Add manifest to file list
    const manifestContent = Buffer.from(manifestJson, "utf-8");
    manifest.files.push({
      path: "manifest.json",
      size: manifestContent.length,
      hash: hashContent(manifestContent),
    });

    // 4. Generate README
    const readmeContent = generateBundleReadme(manifest);
    const readmePath = join(bundleDir, "README.md");
    await writeFile(readmePath, readmeContent, "utf-8");

    const readmeBuffer = Buffer.from(readmeContent, "utf-8");
    manifest.files.push({
      path: "README.md",
      size: readmeBuffer.length,
      hash: hashContent(readmeBuffer),
    });

    // Update manifest on disk with final file list
    const finalManifestJson = JSON.stringify(manifest, null, 2);
    await writeFile(manifestPath, finalManifestJson, "utf-8");

    // 5. Package as tar.gz
    await mkdir(opts.outputDir, { recursive: true });
    const archivePath = join(opts.outputDir, `${exportId}.tar.gz`);

    try {
      await execFileAsync("tar", [
        "czf",
        archivePath,
        "-C",
        stagingDir,
        exportId,
      ]);
    } catch (err: unknown) {
      throw new ExportError(
        `Failed to create tar.gz archive: ${err instanceof Error ? err.message : String(err)}`,
        "TAR_FAILED",
      );
    }

    return {
      exportId,
      archivePath,
      manifest,
    };
  } finally {
    // Clean up staging directory
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}
