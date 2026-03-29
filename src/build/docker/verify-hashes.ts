/**
 * Hash verification for pinned binaries.
 *
 * `clawhq build --verify-hashes` downloads each binary to a temp file
 * and compares its SHA256 against the pinned hash. This is a maintainer
 * tool — run it when updating binary versions to confirm hashes.
 */

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BinaryInstall } from "./types.js";
import type { BinaryVerificationResult, VerificationReport } from "./binary-manifest.js";

/**
 * Download each binary and verify its SHA256 hash against the pinned value.
 *
 * Returns a report with per-binary pass/fail results.
 * Used by `clawhq build --verify-hashes` for maintainer verification.
 */
export async function verifyBinaryHashes(
  binaries: readonly BinaryInstall[],
  onProgress?: (name: string, status: "downloading" | "verifying" | "pass" | "fail") => void,
): Promise<VerificationReport> {
  if (binaries.length === 0) {
    return { results: [], allPassed: true };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "clawhq-verify-"));
  const results: BinaryVerificationResult[] = [];

  try {
    for (const binary of binaries) {
      onProgress?.(binary.name, "downloading");

      const tempPath = join(tempDir, binary.name);
      let actual: string;

      try {
        const response = await fetch(binary.url);
        if (!response.ok) {
          results.push({
            name: binary.name,
            expected: binary.sha256,
            actual: `download failed: HTTP ${response.status}`,
            ok: false,
          });
          onProgress?.(binary.name, "fail");
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(tempPath, buffer);

        onProgress?.(binary.name, "verifying");
        actual = createHash("sha256").update(buffer).digest("hex");
      } catch (err) {
        results.push({
          name: binary.name,
          expected: binary.sha256,
          actual: `download error: ${err instanceof Error ? err.message : String(err)}`,
          ok: false,
        });
        onProgress?.(binary.name, "fail");
        continue;
      }

      const ok = actual === binary.sha256;
      results.push({
        name: binary.name,
        expected: binary.sha256,
        actual,
        ok,
      });
      onProgress?.(binary.name, ok ? "pass" : "fail");
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    results,
    allPassed: results.every((r) => r.ok),
  };
}
