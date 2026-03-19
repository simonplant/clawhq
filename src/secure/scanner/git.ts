/**
 * Git history scanner — finds secrets committed in past diffs.
 *
 * Scans git log diffs (added lines only) for the same patterns as
 * the file scanner. Catches secrets that were committed then removed.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { scanContent } from "./scanner.js";
import type { Finding } from "./types.js";

const exec = promisify(execFile);

// ── Public API ──────────────────────────────────────────────────────────────

export interface GitScanResult {
  readonly findings: Finding[];
  readonly commitsScanned: number;
}

/**
 * Scan git history for committed secrets.
 *
 * Examines added lines in commit diffs. Only scans text diffs,
 * not binary files. Returns findings with commit hashes.
 */
export async function scanGitHistory(
  repoDir: string,
  maxCommits: number = 100,
  signal?: AbortSignal,
): Promise<GitScanResult> {
  // Check if this is a git repo
  try {
    await exec("git", ["rev-parse", "--git-dir"], { cwd: repoDir, signal });
  } catch {
    return { findings: [], commitsScanned: 0 };
  }

  // Get commit hashes
  let stdout: string;
  try {
    const result = await exec(
      "git",
      ["log", "--format=%H", `-${maxCommits}`, "--diff-filter=AM"],
      { cwd: repoDir, signal, maxBuffer: 10 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch {
    return { findings: [], commitsScanned: 0 };
  }

  const commits = stdout.trim().split("\n").filter(Boolean);
  const findings: Finding[] = [];

  for (const commit of commits) {
    if (signal?.aborted) break;

    try {
      const diff = await exec(
        "git",
        ["diff-tree", "--no-commit-id", "-p", "-U0", "--diff-filter=AM", commit],
        { cwd: repoDir, signal, maxBuffer: 10 * 1024 * 1024 },
      );

      const commitFindings = parseDiffForSecrets(diff.stdout, commit);
      findings.push(...commitFindings);
    } catch {
      // Skip commits that fail to diff (e.g., initial commit edge cases)
      continue;
    }
  }

  return { findings, commitsScanned: commits.length };
}

// ── Diff Parsing ────────────────────────────────────────────────────────────

/**
 * Parse a unified diff and scan added lines for secrets.
 */
function parseDiffForSecrets(diff: string, commit: string): Finding[] {
  const findings: Finding[] = [];
  let currentFile = "";

  for (const line of diff.split("\n")) {
    // Track which file we're in
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      continue;
    }

    // Only scan added lines (not context or removed)
    if (!line.startsWith("+") || line.startsWith("+++")) continue;

    // Strip the leading "+" for scanning
    const addedLine = line.slice(1);
    if (!addedLine.trim()) continue;

    const lineFindings = scanContent(addedLine, currentFile, "git", commit);
    findings.push(...lineFindings);
  }

  return findings;
}
