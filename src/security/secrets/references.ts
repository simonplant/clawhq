/**
 * Dangling secret reference scanner.
 *
 * Scans config files for references to secret names using
 * `${SECRET_NAME}` and `$SECRET_NAME` patterns.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface DanglingReference {
  /** File where the reference was found */
  file: string;
  /** Line number (1-based) */
  line: number;
  /** The matched reference text */
  match: string;
}

/** Config file extensions to scan. */
const SCAN_EXTENSIONS = new Set([
  ".json",
  ".yml",
  ".yaml",
  ".md",
  ".toml",
  ".cfg",
  ".conf",
]);

/** Top-level filenames to always scan. */
const TOP_LEVEL_FILES = new Set([
  "openclaw.json",
  "docker-compose.yml",
  "docker-compose.yaml",
]);

/** Directories to scan recursively. */
const SCAN_DIRS = ["workspace", "configs"];

/** Directories to skip. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".env"]);

/**
 * Build regex patterns to match references to a secret name.
 * Matches: ${SECRET_NAME}, $SECRET_NAME (word-bounded)
 */
function buildPatterns(secretName: string): RegExp[] {
  const escaped = secretName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`\\$\\{${escaped}\\}`, "g"),
    new RegExp(`\\$${escaped}(?![A-Za-z0-9_])`, "g"),
  ];
}

/**
 * Scan a single file's content for references to a secret.
 */
function scanContent(
  content: string,
  filePath: string,
  secretName: string,
): DanglingReference[] {
  const results: DanglingReference[] = [];
  const patterns = buildPatterns(secretName);
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(lines[i])) !== null) {
        results.push({
          file: filePath,
          line: i + 1,
          match: m[0],
        });
      }
    }
  }

  return results;
}

/**
 * Recursively collect scannable files from a directory.
 */
async function collectFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        files.push(...(await collectFiles(fullPath)));
      }
    } else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (SCAN_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Scan config files for dangling references to a revoked secret.
 *
 * @param secretName - The secret name to search for
 * @param baseDir - The directory to scan (defaults to cwd)
 * @returns Array of dangling references found
 */
export async function scanDanglingReferences(
  secretName: string,
  baseDir: string = process.cwd(),
): Promise<DanglingReference[]> {
  const results: DanglingReference[] = [];
  const filesToScan: string[] = [];

  // Collect top-level config files
  for (const name of TOP_LEVEL_FILES) {
    const path = join(baseDir, name);
    try {
      const s = await stat(path);
      if (s.isFile()) filesToScan.push(path);
    } catch {
      // File doesn't exist — skip
    }
  }

  // Also check for docker-compose override files at top level
  try {
    const topEntries = await readdir(baseDir, { withFileTypes: true });
    for (const entry of topEntries) {
      if (
        entry.isFile() &&
        entry.name.startsWith("docker-compose.") &&
        (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) &&
        !TOP_LEVEL_FILES.has(entry.name)
      ) {
        filesToScan.push(join(baseDir, entry.name));
      }
    }
  } catch {
    // Directory not readable
  }

  // Collect files from scan directories
  for (const dir of SCAN_DIRS) {
    filesToScan.push(...(await collectFiles(join(baseDir, dir))));
  }

  // Scan each file
  for (const filePath of filesToScan) {
    try {
      const content = await readFile(filePath, "utf-8");
      results.push(...scanContent(content, filePath, secretName));
    } catch {
      // Unreadable file — skip
    }
  }

  return results;
}
