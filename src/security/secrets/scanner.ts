/**
 * Secret pattern scanner.
 *
 * Detects API keys, tokens, and credentials embedded in config files
 * that should only be in .env.
 */

import { readFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface SecretPattern {
  name: string;
  pattern: RegExp;
}

export interface ScanMatch {
  file: string;
  pattern: string;
  line: number;
}

export interface ScanResult {
  matches: ScanMatch[];
  filesScanned: number;
}

/** Patterns that indicate embedded secrets. */
export const SECRET_PATTERNS: SecretPattern[] = [
  { name: "Anthropic API key", pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: "OpenAI API key", pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub token", pattern: /ghp_[a-zA-Z0-9]{36}/ },
  { name: "GitHub OAuth token", pattern: /gho_[a-zA-Z0-9]{36}/ },
  { name: "Bearer token", pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/ },
  {
    name: "Generic API key",
    pattern:
      /["'](?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)["']\s*:\s*["'][^"']{8,}["']/,
  },
  { name: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Slack token", pattern: /xox[bpors]-[0-9a-zA-Z-]{10,}/ },
  { name: "Telegram bot token", pattern: /\d{8,10}:[a-zA-Z0-9_-]{35}/ },
];

/** File extensions to scan. */
const SCANNABLE_EXTENSIONS = new Set([
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".md",
  ".txt",
  ".ts",
  ".js",
  ".cfg",
  ".conf",
  ".ini",
]);

/** Files to skip (they're supposed to contain secrets). */
const SKIP_FILES = new Set([".env", ".env.example", ".env.local"]);

/**
 * Scan a single file for secret patterns.
 */
export function scanContent(
  content: string,
  filePath: string,
): ScanMatch[] {
  const matches: ScanMatch[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        matches.push({
          file: filePath,
          pattern: name,
          line: i + 1,
        });
      }
    }
  }

  return matches;
}

/**
 * Recursively collect scannable files from a directory.
 */
async function collectFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    // Skip hidden dirs and node_modules
    if (entry.startsWith(".") || entry === "node_modules") continue;

    const fullPath = join(dir, entry);
    const s = await stat(fullPath);

    if (s.isDirectory()) {
      const sub = await collectFiles(fullPath);
      files.push(...sub);
    } else if (s.isFile()) {
      if (SKIP_FILES.has(entry)) continue;
      const ext = entry.slice(entry.lastIndexOf("."));
      if (SCANNABLE_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Scan all config files in a directory for embedded secrets.
 */
export async function scanFiles(directory: string): Promise<ScanResult> {
  const files = await collectFiles(directory);
  const allMatches: ScanMatch[] = [];

  for (const file of files) {
    try {
      const content = await readFile(file, "utf-8");
      const matches = scanContent(content, file);
      allMatches.push(...matches);
    } catch {
      // Skip unreadable files
    }
  }

  return {
    matches: allMatches,
    filesScanned: files.length,
  };
}
