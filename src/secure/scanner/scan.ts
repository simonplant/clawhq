/**
 * Scan orchestrator — runs file and git history scans, produces a report.
 *
 * Main entry point for `clawhq scan [--git] [--json]`.
 * Coordinates directory walk + optional git history scan → report.
 */

import { join } from "node:path";

import type { GitScanResult } from "./git.js";
import { scanGitHistory } from "./git.js";
import type { ScanOptions, ScanReport } from "./types.js";
import { walkAndScan } from "./walk.js";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the PII + secrets scanner.
 *
 * Scans the workspace directory for secrets and PII. Optionally scans
 * git history for previously committed secrets.
 *
 * Never throws — errors are captured and result in an empty report.
 */
export async function runScan(options: ScanOptions): Promise<ScanReport> {
  const workspaceDir = join(options.deployDir, "workspace");

  // File scan
  const fileResult = await walkAndScan(workspaceDir, options.signal);

  // Git history scan (optional)
  let gitResult: GitScanResult = { findings: [], commitsScanned: 0 };
  if (options.git) {
    gitResult = await scanGitHistory(
      options.deployDir,
      options.maxCommits ?? 100,
      options.signal,
    );
  }

  const allFindings = [...fileResult.findings, ...gitResult.findings];

  return {
    timestamp: new Date().toISOString(),
    scanRoot: workspaceDir,
    findings: allFindings,
    fileFindings: fileResult.findings,
    gitFindings: gitResult.findings,
    filesScanned: fileResult.filesScanned,
    commitsScanned: gitResult.commitsScanned,
    clean: allFindings.length === 0,
  };
}
